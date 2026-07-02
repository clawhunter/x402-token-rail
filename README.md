# x402-token-rail

A small open-source module that lets Solana x402 APIs accept their own token as an optional payment rail, offer a discount for paying with it, and unlock perks for holders.

This is for Solana projects, agent tools, data APIs, and AI services that already use x402 and want their own token to have real usage inside x402 payment flows.

> Built and dogfooded by **[clawhunter.fun](https://clawhunter.fun)**, running in
> production on Solana mainnet (Token-2022).

## Why this exists

x402 makes it easy for agents to pay APIs per request, usually with USDC.

That is great for neutral settlement, but it does not create any reason for agents to interact with a project’s own token.

`x402-token-rail` adds that missing incentive layer:

- pay with the project token for cheaper API calls
- hold the project token for holder-only perks
- keep USDC as the fallback rail for everyone else

The goal is simple: make a Solana token useful inside the x402 economy by giving agents a reason to transact with it and keep holding it.

## Example holder-only perks

Holder perks can be anything your API can safely add after settlement:

- bonus response fields
- higher rate limits
- priority execution
- private endpoints
- early access to new routes

---

## What's in the box

| Piece | What it is |
| --- | --- |
| [`token-rail/`](token-rail/) | **The core you copy into your project** — 3 framework-agnostic primitives + the free default oracle. No web-framework imports. |
| [`SKILL.md`](SKILL.md) | **An Agent Skill that wires the rail into your existing x402 API** for you. |
| [`app/api/paid/route.ts`](app/api/paid/route.ts) | Reference wiring: a Next 16 + `@x402/next` route payable in USDC or the token at a discount, with a holders-only bonus. |
| [`app/.well-known/x402/route.ts`](app/.well-known/x402/route.ts) | Reference: the discovery manifest that tells agents about the token benefit. |
| [`scripts/check.ts`](scripts/check.ts) | Sanity-check the oracle and holder gate against live mainnet — no paying client needed. |

## The 3 primitives

Full API in [`token-rail/README.md`](token-rail/README.md).

1. **`createDynamicPrice`** — turns an endpoint's USD price into a discounted token
   amount, live, as an x402 `{ asset, amount }`. Wire it into a payment option's
   dynamic `price`.
2. **`paidWith` / `paidAsset`** — read which rail the caller used, from the payment
   header.
3. **`createHolderGate`** — check a wallet's on-chain balance via
   `getTokenAccountsByOwner`. One call covers both SPL Token and Token-2022.

The default oracle is **`createDexscreenerOracle`** (Dexscreener, free). It's
injected, so you can swap in your own — just don't default to a paid feed.

## Add it to your API

You already have an x402 API. Two ways to add the token rail:

- **Let an agent do it.** Run the [`add-x402-token-rail` skill](SKILL.md) against your
  project — it copies the core in, adds the token payment option, wires the holder
  gate, and updates your discovery copy.
- **By hand.** Copy [`token-rail/`](token-rail/) into your project (no web-framework
  imports), then follow [`SKILL.md`](SKILL.md): build the primitives, add a second
  `accepts` entry priced with `createDynamicPrice` next to your USDC one, and — for
  holder perks — check the settled payer in a wrapper around your handler.

You keep charging USDC; the token option sits beside it. The reference wiring is in
[`app/api/paid/route.ts`](app/api/paid/route.ts).

## Holder gating: do it post-settlement

On Solana, a holder perk can't be a discount, and it can't trust a wallet the caller
names:

- The 402 price is fixed before you know who's paying, and Solana `exact` has no
  adjustable settlement — so "cheaper if you hold" isn't possible.
- Any wallet in the request is spoofable, and the real payer isn't even in the request
  (the payload is a signed transaction, not an address).

So the only safe way to reward holders is *after* payment settles, using the verified
payer the facilitator reports on the `PAYMENT-RESPONSE` header. `paid()` in
`lib/rail.ts` does this — copy that pattern.

## Good to know

- **Token-2022.** `@x402/svm` handles both SPL Token and Token-2022 automatically. Two
  caveats: your `payTo` wallet needs an existing token account (ATA) for the mint or
  the transfer fails, and transfer-fee tokens deliver slightly less than charged.
- **The default price oracle is free** (Dexscreener). Swap in your own only if you want
  a different source — a paid feed isn't required.

## Holder eligibility preflight (advisory)

An agent can check whether a wallet qualifies for the holder bonus before paying.
Send `X-Holder-Check: <wallet>` on a request to the paid endpoint, and the 402
response comes back with these headers:

```
X-Holder-Mint:      <mint>
X-Holder-Minimum:   100000
X-Holder-Wallet:    <wallet>
X-Holder-Balance:   <whole tokens held>
X-Holder-Eligible:  true | false | unknown
X-Holder-Advisory:  true
```

It's headers-only, so the x402 challenge body stays untouched. Treat it as a hint,
not authorization: the declared wallet is spoofable and balances change, so the perk
is still granted post-settlement against the real signed payer. And since this is the
bonus model, a non-holder who pays anyway still gets the base resource — the preflight
just saves them from paying when the bonus was the whole point.

## Surface it in your discovery copy

The rail only creates demand if agents know it exists. Mention the token contract and
the pay/hold benefit wherever agents read how to use your API — `openapi.json`,
`llms.txt`, your `/docs`, and `/.well-known/x402`. A blurb you can paste:

> **Pay with $TOKEN for a discount.** This API accepts `$TOKEN` (mint `<MINT>`) on
> Solana as an x402 payment option at **20% off** vs USDC. **Hold ≥ 100,000 $TOKEN**
> to unlock holders-only perks. See `/.well-known/x402`.

The demo's [`/.well-known/x402`](app/.well-known/x402/route.ts) route models the
machine-readable half.

## Run the reference demo (optional)

This repo is also a runnable Next app, so you can watch the whole flow work before
touching your own API.

```bash
nvm use            # Node 22
npm install
cp .env.example .env
npm run dev        # http://localhost:3000
```

`X402_ENABLED=false` by default, so it runs free — no wallet, no secrets:

```bash
curl -s localhost:3000/api/paid | jq
curl -s localhost:3000/.well-known/x402 | jq
```

To exercise real payments, set `X402_ENABLED=true` + `X402_PAY_TO` and point
`TOKEN_MINT` / `TOKEN_DECIMALS` / `TOKEN_DISCOUNT` / `HOLDER_MIN_TOKENS` at your token.
Or check the primitives directly, no paying client needed:

```bash
npm run check                       # price the default token live
npm run check -- <mint> <wallet>    # + a live holder-balance check
```

## Adopters

x402 APIs that accept a native token as payment. **Open a PR to add yours** —
alphabetical under the flagship.

| API | Token | Description | Link |
| --- | --- | --- | --- |
| **clawhunter.fun** (reference impl #1) | $CLAWHUNTER (Solana) | The bounty-hunting layer for AI agents. | [clawhunter.fun](https://clawhunter.fun) |
| _your API here_ | | | |

## License

MIT. Built and dogfooded by [clawhunter.fun](https://clawhunter.fun).
