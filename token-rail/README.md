# `token-rail/` — the core

Three framework-agnostic primitives (x402 core types only, zero web-framework
imports, dependency-free beyond `fetch`). Copy this folder into your x402 project.

```ts
import {
  createDynamicPrice,
  createDexscreenerOracle,
  paidWith,
  createHolderGate,
  wholeTokens,
} from "./token-rail";
```

## 1. `createDynamicPrice` — pay with the token at a discount

Turns an endpoint's USD price into the discounted token amount to charge, live,
as an x402 `{ asset, amount }`. Wire it into a payment option's dynamic `price`.

```ts
const mint = "6GGY8GViCR5v4xR4Lxb4nfiAJsEoJua5Gj6YecxbJ4BQ"; // your token
const dynamicPrice = createDynamicPrice({
  mint,
  decimals: 6,
  discount: 0.2,                                   // 20% off vs USDC
  getUsdPrice: createDexscreenerOracle(mint),      // free default oracle (injectable)
  maxTokens: 30_000,                               // safety cap (0 = off)
  fallbackUsd: null,                               // last-resort price if oracle misses
});

// price for a $0.05 endpoint, atomic units:
const { asset, amount } = await dynamicPrice(0.05);
```

Keeps the last good price in-process, so a transient oracle miss falls back
instead of failing. Formula: `tokens = usd × (1 − discount) ÷ liveTokenUsd`.

## 2. `paidWith` / `paidAsset` — which rail did they use

Reads the contractual `accepted.asset` off the base64 x402 payment header. Safe
to call any time; only gates cosmetic "you paid in $TOKEN" behavior.

```ts
if (paidWith(req.headers.get("x-payment"), mint)) {
  // caller chose the token rail — echo the discount, etc.
}
```

`settledPayer(paymentResponseHeader)` returns the signature-verified payer from a
**response** `PAYMENT-RESPONSE` header (see the holder gate below for why that's
the only trustworthy source).

## 3. `createHolderGate` — perks for HOLDING the token

On-chain balance check via `getTokenAccountsByOwner`. One `{ mint }` call covers
both SPL Token and Token-2022. Caches per owner.

```ts
const gate = createHolderGate({
  rpc: process.env.SOLANA_RPC_URL!,
  mint,
  minBalance: wholeTokens(100_000, 6), // hold ≥100k to unlock perks
});

// POST-SETTLEMENT: pass the settled payer, read from the response header (see footgun):
const payer = settledPayer(res.headers.get("PAYMENT-RESPONSE"));
const isHolder = payer ? await gate.isHolder(payer) : false;
```

### ⚠️ Footgun: gate holders POST-SETTLEMENT, and use the settled payer

On Solana you can't make holding a discount: the 402 price is fixed before you know
the payer, `exact` has no `upto`/partial settlement, and a client-declared wallet is
spoofable. So a holder benefit must be a **post-settlement perk**.

The payer isn't even in the request — the `exact` payload is a signed transaction.
The verified payer only appears on the response's `PAYMENT-RESPONSE` header, after
settlement. So gate in a wrapper around your x402 handler and read `settledPayer(...)`
from it (see `lib/rail.ts`). Full write-up in `holder-gate.ts`.

### ⚠️ Footgun: Token-2022

`@x402/svm` auto-detects the token program from the mint, but your `payTo` wallet
must already hold an ATA for the mint, and transfer-fee tokens net the recipient
less than the stated amount.

## Oracle is pluggable

`createDexscreenerOracle` (Dexscreener, free) is the default. Inject any
`() => Promise<number | null>` to use your own source. **Don't** default to
Jupiter or another paid endpoint — keep the zero-cost path the default.
