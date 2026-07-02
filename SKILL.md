---
name: add-x402-token-rail
description: Add a native Solana token as an x402 payment option at a discount, and gate perks on holding it, to an existing x402 API. Use when a project already serves paid x402 routes (USDC) and wants to let agents pay with — and hold — a specific SPL / Token-2022 token. Covers the pay-with-discount rail, the post-settlement holder gate, and the agent-facing discovery copy.
---

# Add an x402 token rail (pay-with-discount + holder gate)

Wire the `token-rail/` core into an existing x402 API so agents can pay in a
native Solana token at a discount and unlock perks by holding it.

## Preconditions (verify first)

- The project already gates routes with x402 and settles on **Solana** (an
  `ExactSvmScheme` / `@x402/svm` setup, a facilitator, a `payTo` Solana wallet).
  If it only settles on an EVM chain, stop — this rail is Solana-specific.
- You know the token's **mint** and **decimals**, and the `payTo` wallet already
  holds an **ATA** for that mint (Token-2022 mint → Token-2022 ATA). Without the
  ATA, settlement of the token rail fails.

## Steps

1. **Copy the core.** Drop the `token-rail/` folder into the project (it has no
   web-framework imports). Confirm with a grep that it imports nothing from
   `next`/`react`/your framework.

2. **Build the primitives once**, at module scope near the existing x402 setup:
   ```ts
   import { createDynamicPrice, createDexscreenerOracle, createHolderGate, wholeTokens } from "./token-rail";

   const MINT = "<mint>", DECIMALS = 6;
   const dynamicPrice = createDynamicPrice({
     mint: MINT, decimals: DECIMALS, discount: 0.2,
     getUsdPrice: createDexscreenerOracle(MINT), // free default oracle
     maxTokens: 0, fallbackUsd: null,
   });
   const holderGate = createHolderGate({ rpc: process.env.SOLANA_RPC_URL!, mint: MINT, minBalance: wholeTokens(100_000, DECIMALS) });
   ```

3. **Add a second Solana `accepts` entry** alongside the existing USDC one, using
   the SAME `payTo` wallet, with a dynamic price:
   ```ts
   {
     scheme: "exact",
     network: SOLANA_NETWORK,
     payTo: PAY_TO,
     price: () => dynamicPrice(endpointUsdPrice), // re-priced live per request
     extra: { description, mimeType: "application/json" },
   }
   ```
   Keep the USDC entry so agents that don't hold the token can still pay.

4. **Gate the holder perk POST-SETTLEMENT, in a wrapper around your x402 gate —
   NOT inside the route handler.** The handler runs after the payment verifies but
   before it settles, and the payer is not in the request payload (the Solana
   `exact` payload is a signed wire transaction). The signature-verified payer only
   arrives on the response's `PAYMENT-RESPONSE` header after settlement. So wrap the
   gated handler, read the settled payer from that header, then check balance:
   ```ts
   import { settledPayer } from "./token-rail";

   const gated = withX402(handler, config, server); // your existing x402 wrapper
   export const POST = async (req) => {
     const res = await gated(req);                   // verify → handler → settle
     if (res.status !== 200) return res;
     const payer = settledPayer(res.headers.get("PAYMENT-RESPONSE"));
     if (!payer) return res;
     const isHolder = await holderGate.isHolder(payer);
     // merge isHolder-gated fields into the JSON body, preserving PAYMENT-RESPONSE
     return withHolderFields(res, isHolder);
   };
   ```
   **Do not** gate on a wallet the client declares in a body/param, or on a payer
   scraped from the request — both are absent/spoofable. Only the settled signer
   from `PAYMENT-RESPONSE` counts. (`paidWith(reqHeader, MINT)` is still fine inside
   the handler for cosmetic "you paid in $TOKEN" detection — that reads the
   contractual `accepted.asset`, not the payer.)

   *Optional — advisory preflight:* on the unpaid 402, read an agent-declared wallet
   from a request header (e.g. `X-Holder-Check`) and return its eligibility in
   response headers (`X-Holder-Eligible`, `X-Holder-Balance`), so an agent can skip
   paying if it only wanted the bonus. Headers-only, so the 402 body is untouched.
   Advisory (spoofable, non-binding) — the real grant stays post-settlement.

5. **Surface it in discovery copy** — the rail is worthless if agents don't know
   it exists. Update everywhere agents read how to use the API:
   - `/.well-known/x402` — add the token to `accepts[]` (amount `"dynamic"`).
   - `openapi.json`, `llms.txt`, `/docs` — one line per the blurb below.

   > **Pay with $TOKEN for a discount.** Accepts `$TOKEN` (mint `<MINT>`) on
   > Solana as an x402 payment option at N% off vs USDC. Hold ≥ X to unlock
   > holders-only perks.

6. **Verify** with `scripts/check.ts` (live oracle + holder balance, no client
   needed), then a real 402: hit the endpoint and confirm two Solana `accepts`
   entries — USDC and the live-priced token.

## Footguns to respect

- Holder gating is **post-settlement only** (price is fixed pre-payer; no `upto`
  on Solana; declared wallets spoofable).
- **Token-2022**: `payTo` needs an ATA; transfer-fee tokens net less than stated.
- Keep the oracle **free by default** (Dexscreener); inject a paid one only if
  needed.

Reference implementation: [clawhunter.fun](https://clawhunter.fun).
