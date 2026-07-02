// Default free USD-price oracle for a Solana token, via Dexscreener.
//
// Dexscreener publishes a clean per-token `priceUsd` and is free and
// unauthenticated. This is the DEFAULT oracle so the rail costs nothing to run —
// but it is injected, so adopters can swap in any `() => Promise<number>` (their
// own indexer, a paid feed, an AMM quote). Don't default to a paid endpoint;
// keep the zero-cost path the default.
//
// Framework-agnostic and dependency-free (raw `fetch` only) so this module can
// be copied straight into any project.

export interface DexscreenerOracleOptions {
  /** Inject a fetch implementation (tests, non-global-fetch runtimes). */
  fetchImpl?: typeof fetch;
}

const DEXSCREENER_BASE = "https://api.dexscreener.com/tokens/v1/solana";

/**
 * Build a live USD-price oracle for one mint. The returned function reads the
 * latest price on every call (no caching — the rail's price builder keeps its
 * own last-good fallback), returning `null` when the source misses so the caller
 * can fall back or fail explicitly.
 */
export function createDexscreenerOracle(
  mint: string,
  opts: DexscreenerOracleOptions = {},
): () => Promise<number | null> {
  const doFetch = opts.fetchImpl ?? fetch;

  return async function getUsdPrice(): Promise<number | null> {
    if (!mint) return null;
    try {
      const res = await doFetch(`${DEXSCREENER_BASE}/${mint}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as Array<{ priceUsd?: string }>;
        const p = Array.isArray(data) ? Number(data[0]?.priceUsd) : NaN;
        if (Number.isFinite(p) && p > 0) return p;
      }
    } catch {
      /* fall through to null */
    }
    return null;
  };
}
