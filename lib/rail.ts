// Next glue: env config → the token-rail primitives + a minimal x402 `paid()`
// wrapper. This is the ONLY file that couples the core to a web framework
// (Next + @x402/next). Everything reusable lives in ../token-rail (no Next here).
//
// One Solana network, USDC + one native-token rail, one gated route. Env-gated so
// the repo runs FREE with zero secrets — the gate is a no-op unless
// X402_ENABLED=true AND X402_PAY_TO is set.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withX402, x402ResourceServer, type RouteConfig } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { SOLANA_MAINNET_CAIP2 } from "@x402/svm";
import type { Network } from "@x402/core/types";
import { facilitator as payaiFacilitator } from "@payai/facilitator";

import {
  createDynamicPrice,
  createDexscreenerOracle,
  createHolderGate,
  settledPayer,
  wholeTokens,
} from "../token-rail";

// ── Config (env-driven) ──────────────────────────────────────────────────────
const NETWORK = (process.env.X402_NETWORK || SOLANA_MAINNET_CAIP2) as Network;
const PAY_TO = process.env.X402_PAY_TO ?? "";
export const PRICE = process.env.X402_PRICE || "$0.01";
export const PRICE_USD = Number(PRICE.replace(/[^0-9.]/g, "")) || 0.01;

// The native token you're adding utility to. Defaults to CLAWHUNTER (Token-2022,
// 6 decimals) so the demo works out of the box; point these at your own token.
export const TOKEN_MINT =
  process.env.TOKEN_MINT || "6GGY8GViCR5v4xR4Lxb4nfiAJsEoJua5Gj6YecxbJ4BQ";
export const TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS) || 6;
const TOKEN_DISCOUNT = Number(process.env.TOKEN_DISCOUNT ?? "0.2");
const TOKEN_MAX_TOKENS = Number(process.env.TOKEN_MAX_TOKENS) || 0;
const TOKEN_USD_FALLBACK = Number(process.env.TOKEN_USD_FALLBACK) || null;

// USDC mainnet mint — for the discovery hint only; the live 402 resolves USDC
// from the plain "$0.01" price via the scheme's money parser.
export const USDC_SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Holder gate: hold ≥ HOLDER_MIN_TOKENS of TOKEN_MINT to unlock the perk.
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const HOLDER_MIN_TOKENS = Number(process.env.HOLDER_MIN_TOKENS) || 100_000;

export const x402Enabled = process.env.X402_ENABLED === "true" && PAY_TO !== "";
// The token rail rides on the same Solana payout wallet; on whenever x402 is on.
export const tokenRailEnabled = x402Enabled;

// ── Primitives, built once ───────────────────────────────────────────────────
export const dynamicPrice = createDynamicPrice({
  mint: TOKEN_MINT,
  decimals: TOKEN_DECIMALS,
  discount: TOKEN_DISCOUNT,
  getUsdPrice: createDexscreenerOracle(TOKEN_MINT),
  maxTokens: TOKEN_MAX_TOKENS,
  fallbackUsd: TOKEN_USD_FALLBACK,
});

const HOLDER_MIN_ATOMIC = wholeTokens(HOLDER_MIN_TOKENS, TOKEN_DECIMALS);
export const holderGate = createHolderGate({
  rpc: SOLANA_RPC_URL,
  mint: TOKEN_MINT,
  minBalance: HOLDER_MIN_ATOMIC,
});

export const HOLDER_MIN_LABEL = `${HOLDER_MIN_TOKENS.toLocaleString("en-US")} tokens`;
export const TOKEN_DISCOUNT_PCT = Math.round(Math.min(0.95, Math.max(0, TOKEN_DISCOUNT)) * 100);

// One resource server shared across gated routes. `withX402` syncs the
// facilitator at construction, so build it once at module scope.
let serverSingleton: x402ResourceServer | null = null;
function resourceServer(): x402ResourceServer {
  if (!serverSingleton) {
    const facilitatorConfig = process.env.X402_FACILITATOR_URL
      ? { ...payaiFacilitator, url: process.env.X402_FACILITATOR_URL }
      : payaiFacilitator;
    serverSingleton = new x402ResourceServer(
      new HTTPFacilitatorClient(facilitatorConfig),
    ).register(NETWORK, new ExactSvmScheme());
  }
  return serverSingleton;
}

type Handler = (req: NextRequest) => Promise<NextResponse>;

/**
 * Gate a route behind x402. Unconfigured (X402_ENABLED!=true or no payTo) →
 * returns the handler untouched so local dev is free.
 *
 * Enabled → answers unpaid requests with 402 (two Solana options: USDC and the
 * discounted token), runs the handler once the payment VERIFIES, settles on
 * success, then — in the post-settlement wrapper below — reads the facilitator-
 * verified payer and applies the HOLDER GATE.
 *
 * Why the holder gate lives here and not in the route handler: withX402 runs
 * verify → handler → settle. The real payer is only knowable AFTER settlement — it
 * is NOT in the request payload (the Solana `exact` payload is a signed wire
 * transaction, not an address). The settled, signature-verified payer arrives on
 * the response's PAYMENT-RESPONSE header, which only this wrapper can see. Gating
 * inside the handler would mean gating on an absent/unverified value — the exact
 * footgun this repo exists to prevent.
 */
export function paid(handler: Handler, description: string): Handler {
  if (!x402Enabled) return handler;

  type PaymentOption = Exclude<RouteConfig["accepts"], readonly unknown[]>;
  const accepts: PaymentOption[] = [
    // USDC on Solana — plain USD price, auto-resolved by the scheme's money parser.
    {
      scheme: "exact",
      network: NETWORK,
      payTo: PAY_TO,
      price: PRICE,
      extra: { description, mimeType: "application/json" },
    },
    // Native token on Solana — priced live from the token's USD price with the
    // discount applied. The dynamic-price fn re-runs per request.
    {
      scheme: "exact",
      network: NETWORK,
      payTo: PAY_TO,
      price: () => dynamicPrice(PRICE_USD),
      extra: { description, mimeType: "application/json" },
    },
  ];

  const gated = withX402(
    handler,
    {
      accepts,
      description,
      serviceName: "x402-token-rail demo",
      tags: ["x402", "solana", "token", "agents"],
    },
    resourceServer(),
  );

  return async (req) => {
    const res = await gated(req);
    // Unpaid → 402: attach an ADVISORY holder-eligibility preflight (headers only,
    // body untouched) so an agent can see BEFORE paying whether its wallet qualifies.
    if (res.status === 402) return withHolderPreflight(req, res);
    // Only augment a settled success. Handler errors pass through untouched.
    if (res.status !== 200) return res;
    const payer = settledPayer(
      res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE"),
    );
    if (!payer) return res;
    const isHolder = await holderGate.isHolder(payer); // fails closed internally
    return withHolderField(res, payer, isHolder);
  };
}

/**
 * Attach an ADVISORY holder-eligibility preflight to the 402 challenge — headers
 * only, so the x402 challenge body stays byte-for-byte intact and clients parse it
 * normally. Always advertises the rule (mint + minimum). If the agent sets the
 * `X-Holder-Check: <wallet>` request header, also reports whether that wallet meets
 * the minimum right now, so it can skip paying if it only wanted the holder bonus.
 *
 * This is a HINT, not authorization: the declared wallet is spoofable and the
 * balance can change before payment. The perk is still granted post-settlement
 * against the real signed payer (see withHolderField). Bonus model — a non-holder
 * who pays anyway still gets the base resource, just not the bonus.
 */
async function withHolderPreflight(req: NextRequest, res: NextResponse): Promise<NextResponse> {
  const headers = new Headers(res.headers);
  headers.set("X-Holder-Mint", TOKEN_MINT);
  headers.set("X-Holder-Minimum", String(HOLDER_MIN_TOKENS));
  // The perk is granted post-settlement against the signed payer, not from this hint.
  headers.set("X-Holder-Advisory", "true");

  const wallet = req.headers.get("x-holder-check");
  if (wallet) {
    headers.set("X-Holder-Wallet", wallet);
    try {
      const atomic = await holderGate.balanceOf(wallet);
      headers.set("X-Holder-Balance", (Number(atomic) / 10 ** TOKEN_DECIMALS).toString());
      headers.set("X-Holder-Eligible", atomic >= HOLDER_MIN_ATOMIC ? "true" : "false");
    } catch {
      headers.set("X-Holder-Eligible", "unknown"); // RPC unavailable — retry
    }
  }

  // Re-emit the 402 with the same body + status, only adding the preflight headers.
  return new NextResponse(await res.text(), { status: res.status, headers });
}

/**
 * Splice the holder-gate result into a settled JSON response as a `holder` field,
 * preserving x402's settlement headers. Non-JSON responses pass through untouched.
 */
async function withHolderField(
  res: NextResponse,
  payer: string,
  isHolder: boolean,
): Promise<NextResponse> {
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) return res;
  let body: Record<string, unknown>;
  try {
    body = await res.clone().json();
  } catch {
    return res;
  }
  const out = NextResponse.json(
    {
      ...body,
      holder: {
        address: payer,
        isHolder,
        minimum: HOLDER_MIN_LABEL,
        bonus: isHolder
          ? `Unlocked: you hold ≥ ${HOLDER_MIN_LABEL}. Here's the holders-only payload.`
          : `Locked. Hold ≥ ${HOLDER_MIN_LABEL} to unlock the holders-only payload.`,
      },
    },
    { status: res.status },
  );
  // Carry over x402's headers (notably PAYMENT-RESPONSE) onto the rewritten body.
  res.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === "content-type" || k === "content-length") return;
    out.headers.set(key, value);
  });
  return out;
}
