import {
  x402Enabled,
  tokenRailEnabled,
  TOKEN_MINT,
  TOKEN_DISCOUNT_PCT,
  HOLDER_MIN_LABEL,
  PRICE,
} from "../lib/rail";

export default function Home() {
  const wrap: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: "48px 24px" };
  const code: React.CSSProperties = {
    background: "#16161d",
    border: "1px solid #26262f",
    borderRadius: 8,
    padding: "12px 14px",
    display: "block",
    whiteSpace: "pre-wrap",
    fontSize: 13,
  };
  const a: React.CSSProperties = { color: "#7cc4ff" };

  return (
    <main style={wrap}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>x402-token-rail</h1>
      <p style={{ color: "#9a9aa6", marginTop: 0 }}>
        Add utility to your x402 token: let agents <strong>pay</strong> with it at a discount,
        and unlock perks when they <strong>hold</strong> it.
      </p>

      <p>
        Status:{" "}
        <span style={{ color: x402Enabled ? "#7ee787" : "#e3b341" }}>
          {x402Enabled ? "payments ENABLED" : "unconfigured (running FREE)"}
        </span>
        {tokenRailEnabled ? " · token rail on" : ""}
      </p>

      <ul>
        <li>
          Token mint: <code>{TOKEN_MINT}</code>
        </li>
        <li>Price: {PRICE} (payable in USDC or the token)</li>
        <li>Token discount: {TOKEN_DISCOUNT_PCT}% off vs USDC</li>
        <li>Holder perk unlocks at: {HOLDER_MIN_LABEL}</li>
      </ul>

      <h2 style={{ fontSize: 16 }}>Try it</h2>
      <p>The paid endpoint (402 when enabled, free JSON when unconfigured):</p>
      <code style={code}>curl -s localhost:3000/api/paid | jq</code>
      <p>The discovery manifest agents read to learn the token benefit:</p>
      <code style={code}>curl -s localhost:3000/.well-known/x402 | jq</code>

      <p style={{ marginTop: 40, color: "#6b6b76", fontSize: 13 }}>
        Built + dogfooded by{" "}
        <a style={a} href="https://clawhunter.fun">
          clawhunter.fun
        </a>
        . Reference implementation #1.
      </p>
    </main>
  );
}
