// Asset + payer detection for the x402 payment flow.
//
// Two different sources, read at two different times:
//
//   • paidAsset / paidWith — read the REQUEST's `X-PAYMENT` header (base64 JSON).
//     `accepted.asset` is a contractual field naming the mint/contract the client
//     chose to pay with. Available as soon as the request arrives. Safe to use for
//     cosmetic "you paid in $TOKEN" behavior.
//
//   • settledPayer — read the RESPONSE's `PAYMENT-RESPONSE` header, which the
//     resource server attaches AFTER settlement. It carries the facilitator's
//     signature-verified payer. This is the ONLY trustworthy source of the payer
//     for authorization/gating: the request payload does NOT contain the payer
//     address (for the Solana `exact` scheme it's a base64 wire transaction, and
//     the payer is derived server-side during verify/settle). Only available once
//     settlement has run — see lib/rail.ts for the post-settlement wrapper.
//
// Framework-agnostic: everything here operates on raw header STRINGS, so it works
// in Next, Express, Hono, workers — anywhere.

/** Decode a base64 (standard or URL-safe) JSON header into an object, or null. */
function decodeBase64Json(header: string | null | undefined): unknown | null {
  if (!header) return null;
  try {
    const normalized = header.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Decode a request `X-PAYMENT` header into its JSON payload, or null. */
export function decodePaymentHeader(header: string | null | undefined): unknown | null {
  return decodeBase64Json(header);
}

/**
 * The asset (mint / contract) the caller chose to pay this request with, or null.
 * Reads the contractual `accepted.asset` field off the decoded `X-PAYMENT` payload.
 */
export function paidAsset(header: string | null | undefined): string | null {
  const decoded = decodePaymentHeader(header) as { accepted?: { asset?: unknown } } | null;
  const asset = decoded?.accepted?.asset;
  return typeof asset === "string" ? asset : null;
}

/** True when the caller is paying THIS request with the given mint (vs USDC/other). */
export function paidWith(header: string | null | undefined, mint: string): boolean {
  return paidAsset(header) === mint;
}

/**
 * The signature-verified payer, read from the RESPONSE's `PAYMENT-RESPONSE` header
 * (base64 JSON with a `payer` field, attached by the resource server on settlement).
 * This is the wallet that actually signed and settled the payment — safe to use for
 * holder gating. Returns null if the header is absent/undecodable (e.g. an unpaid
 * request, or before settlement ran).
 *
 * Accepts the raw header value from either `PAYMENT-RESPONSE` or `X-PAYMENT-RESPONSE`.
 */
export function settledPayer(paymentResponseHeader: string | null | undefined): string | null {
  const decoded = decodeBase64Json(paymentResponseHeader) as { payer?: unknown } | null;
  return typeof decoded?.payer === "string" && decoded.payer ? decoded.payer : null;
}
