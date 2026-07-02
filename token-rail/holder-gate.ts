// Holder gate — grant perks for HOLDING a token, checked on-chain.
//
// Reads a wallet's token balance via the Solana JSON-RPC `getTokenAccountsByOwner`
// and answers "does this wallet hold at least `minBalance`?". Dependency-free
// (raw fetch); no @solana/web3.js.
//
// ─── THE CRITICAL FOOTGUN — gate POST-SETTLEMENT only ────────────────────────
// On Solana you CANNOT turn "holds the token" into a payment discount:
//   • the 402 price is fixed before you know who the payer is,
//   • Solana `exact` has no `upto` / partial settlement to adjust after the fact,
//   • any wallet the client DECLARES (in a body/param/header) is spoofable.
// So a holder benefit must be a POST-SETTLEMENT PERK: read the payer from the
// settlement result — the resource server's PAYMENT-RESPONSE header carries the
// facilitator's signature-verified payer (the request payload does NOT contain the
// address). Check THAT wallet's balance with this gate and add something to the
// response. Never gate on a pre-payment or client-declared wallet. See
// `settledPayer()` in detect.ts and the post-settlement wrapper in lib/rail.ts.
//
// ─── Token-2022 ──────────────────────────────────────────────────────────────
// `getTokenAccountsByOwner` with a `{ mint }` filter returns the owner's account
// for that mint REGARDLESS of token program — the account is owned by whichever
// program (SPL Token or Token-2022), and filtering by mint finds it either way.
// So ONE call covers both programs; no need to query each program id separately.

export interface HolderGateConfig {
  /** Solana JSON-RPC endpoint (a paid/private RPC is recommended for production). */
  rpc: string;
  /** The token mint (base58) to check balances of. */
  mint: string;
  /**
   * Minimum balance to count as a holder, in ATOMIC units (bigint). Use
   * `wholeTokens(n, decimals)` to convert from whole tokens. Default 1n (holds any).
   */
  minBalance?: bigint;
  /** Per-owner cache TTL in ms. Default 60_000. Set 0 to disable caching. */
  cacheTtlMs?: number;
  /** Inject a fetch implementation (tests, non-global-fetch runtimes). */
  fetchImpl?: typeof fetch;
}

export interface HolderGate {
  /** Total balance across the owner's accounts for the mint, in atomic units. */
  balanceOf(owner: string): Promise<bigint>;
  /** True when the owner's balance ≥ minBalance. Fails CLOSED (RPC error → false). */
  isHolder(owner: string): Promise<boolean>;
}

/** Convert whole tokens to atomic units for `minBalance`. */
export function wholeTokens(amount: number, decimals: number): bigint {
  // Route through a string to avoid float error on large amounts.
  const [whole, frac = ""] = String(amount).split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole + fracPadded);
}

interface RpcTokenAccount {
  account: {
    data: { parsed: { info: { tokenAmount: { amount: string } } } };
  };
}

/**
 * Create a holder gate for one mint. `isHolder` is what you call post-settlement
 * with the real payer's address.
 */
export function createHolderGate(cfg: HolderGateConfig): HolderGate {
  const doFetch = cfg.fetchImpl ?? fetch;
  const minBalance = cfg.minBalance ?? 1n;
  const ttl = cfg.cacheTtlMs ?? 60_000;

  // owner → { balance, at }. A tiny in-process cache so repeated checks for the
  // same wallet (e.g. an agent making many calls) don't hit the RPC every time.
  // Bounded (evict oldest) so a long-lived process seeing many distinct wallets
  // can't grow it without limit.
  const CACHE_MAX = 5_000;
  const cache = new Map<string, { balance: bigint; at: number }>();

  async function fetchBalance(owner: string): Promise<bigint> {
    const res = await doFetch(cfg.rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [owner, { mint: cfg.mint }, { encoding: "jsonParsed" }],
      }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`[token-rail] RPC ${res.status} for getTokenAccountsByOwner`);
    const json = (await res.json()) as {
      error?: { message?: string };
      result?: { value?: RpcTokenAccount[] };
    };
    if (json.error) throw new Error(`[token-rail] RPC error: ${json.error.message ?? "unknown"}`);

    const accounts = json.result?.value ?? [];
    let total = 0n;
    for (const a of accounts) {
      const raw = a?.account?.data?.parsed?.info?.tokenAmount?.amount;
      if (typeof raw === "string" && /^\d+$/.test(raw)) total += BigInt(raw);
    }
    return total;
  }

  async function balanceOf(owner: string): Promise<bigint> {
    if (!owner) return 0n;
    if (ttl > 0) {
      const hit = cache.get(owner);
      if (hit && Date.now() - hit.at < ttl) return hit.balance;
    }
    const balance = await fetchBalance(owner);
    if (ttl > 0) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(owner, { balance, at: Date.now() });
    }
    return balance;
  }

  async function isHolder(owner: string): Promise<boolean> {
    if (!owner) return false;
    try {
      return (await balanceOf(owner)) >= minBalance;
    } catch (err) {
      // Fail CLOSED: an RPC hiccup must not silently grant a holders-only perk.
      console.warn(`[token-rail] holder check failed for ${owner}:`, (err as Error).message);
      return false;
    }
  }

  return { balanceOf, isHolder };
}
