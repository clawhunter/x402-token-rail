// x402-token-rail — framework-agnostic core.
//
// Three primitives for adding a native-token payment rail to any x402 API:
//   1. createDynamicPrice   — live token pricing → x402 AssetAmount (pay at a discount)
//   2. paidWith / paidAsset — which rail did the caller pay with
//   3. createHolderGate     — post-settlement on-chain balance check (perks for holding)
//
// Plus createDexscreenerOracle, the free default USD-price oracle.
//
// No web-framework imports live here — copy this folder straight into your project.

export { createDynamicPrice } from "./price";
export type { DynamicPriceConfig, DynamicPrice, AssetAmount } from "./price";

export {
  decodePaymentHeader,
  paidAsset,
  paidWith,
  settledPayer,
} from "./detect";

export { createHolderGate, wholeTokens } from "./holder-gate";
export type { HolderGateConfig, HolderGate } from "./holder-gate";

export { createDexscreenerOracle } from "./oracle";
export type { DexscreenerOracleOptions } from "./oracle";
