// Live token pricing → x402 AssetAmount builder.
//
// Given an endpoint's USD price, returns the discounted amount of a native
// SPL / Token-2022 token to charge, as an x402 `{ asset, amount }` (atomic
// units). Wire the returned function into a payment option's dynamic `price` so
// the token amount re-prices per request as the market moves.
//
// Framework-agnostic: the return shape is structurally the x402 core
// AssetAmount ({ asset, amount }); no web-framework import needed.

export interface DynamicPriceConfig {
  /** The token mint (base58). Named explicitly so the scheme bypasses USD→USDC parsing. */
  mint: string;
  /** Token decimals (e.g. 6 for most pump.fun / Token-2022 tokens). */
  decimals: number;
  /**
   * Injected USD-price oracle. Returns the token's current USD price, or null if
   * unavailable. Default in the demo is `createDexscreenerOracle(mint)` (free).
   */
  getUsdPrice: () => Promise<number | null>;
  /**
   * Discount vs the USD price, clamped 0..0.95. 0.2 = the payer spends 20% fewer
   * dollars' worth of token than a USDC payer for the same endpoint.
   */
  discount?: number;
  /**
   * Hard ceiling on WHOLE tokens charged per call — a safety net against a price
   * glitch demanding absurd amounts. 0 (default) disables it. When set, a glitch
   * can only ever UNDERcharge (clamp down), never overcharge the payer.
   */
  maxTokens?: number;
  /** Last-resort USD price if the live oracle misses on a cold start. null = none. */
  fallbackUsd?: number | null;
}

export interface AssetAmount {
  asset: string;
  amount: string;
}

/** The function wired into an x402 payment option's dynamic `price`. */
export type DynamicPrice = (usdPrice: number) => Promise<AssetAmount>;

/**
 * Build a dynamic-price function for a token payment rail.
 *
 * The returned function converts an endpoint's USD price into a discounted token
 * amount: `tokens = usd × (1 − discount) ÷ liveTokenUsd`, in atomic units, capped.
 * It keeps the last good token USD price in-process, so a single transient oracle
 * miss falls back to the last known price (then `fallbackUsd`) instead of failing.
 */
export function createDynamicPrice(cfg: DynamicPriceConfig): DynamicPrice {
  const discount = Math.min(0.95, Math.max(0, cfg.discount ?? 0));
  const maxTokens = cfg.maxTokens && cfg.maxTokens > 0 ? cfg.maxTokens : 0;
  const decimals = cfg.decimals;
  const scale = 10 ** decimals;

  // In-process last-good price. Not shared across instances/processes — purely a
  // per-instance cushion for a transient oracle blip.
  let lastGoodUsd: number | null = null;

  async function tokenUsd(): Promise<number | null> {
    const live = await cfg.getUsdPrice();
    if (live && live > 0) {
      lastGoodUsd = live;
      return live;
    }
    return lastGoodUsd ?? cfg.fallbackUsd ?? null;
  }

  return async function dynamicPrice(usdPrice: number): Promise<AssetAmount> {
    const price = await tokenUsd();
    if (!price || price <= 0) {
      throw new Error(
        `[token-rail] token USD price unavailable for ${cfg.mint}; set fallbackUsd or check the oracle`,
      );
    }

    const tokens = (usdPrice * (1 - discount)) / price;
    let atomic = BigInt(Math.max(1, Math.round(tokens * scale)));

    if (maxTokens > 0) {
      const capAtomic = BigInt(Math.round(maxTokens * scale));
      if (atomic > capAtomic) {
        console.warn(
          `[token-rail] amount ${atomic} exceeds cap ${capAtomic} (${maxTokens} tokens) for $${usdPrice}; clamping. Price glitch? tokenUsd=${price}`,
        );
        atomic = capAtomic;
      }
    }

    return { asset: cfg.mint, amount: atomic.toString() };
  };
}
