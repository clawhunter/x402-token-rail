import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { paid, TOKEN_MINT, TOKEN_DISCOUNT_PCT } from "../../../lib/rail";
import { paidWith } from "../../../token-rail";

// A demo paid endpoint. This handler runs AFTER the payment verifies but BEFORE
// settlement, so it only does request-time work: detect which rail the caller used
// (from the `X-PAYMENT` header) and return the resource.
//
// The HOLDER GATE — a perk for HOLDING the token — needs the settlement-verified
// payer, which does not exist yet at this point (it's not in the request payload).
// So it runs in the paid() wrapper (see lib/rail.ts), which appends a `holder`
// field to this response after settlement. See token-rail/holder-gate.ts for why
// holder gating MUST be post-settlement.
async function handler(req: NextRequest): Promise<NextResponse> {
  const paymentHeader = req.headers.get("x-payment") ?? req.headers.get("payment-signature");
  const usedTokenRail = paidWith(paymentHeader, TOKEN_MINT);

  return NextResponse.json({
    ok: true,
    message: "This is the paid resource. You paid, so here it is.",
    paidWithToken: usedTokenRail,
    discountApplied: usedTokenRail ? `${TOKEN_DISCOUNT_PCT}% off vs USDC` : null,
    // `holder: { address, isHolder, bonus }` is appended by paid() post-settlement.
  });
}

export const POST = paid(handler, "x402-token-rail demo — pay in USDC or the native token at a discount; holders unlock a bonus.");
export const GET = POST;
