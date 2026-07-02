export const metadata = {
  title: "x402-token-rail",
  description:
    "Accept your native Solana token as an x402 payment option at a discount, and gate perks on holding it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          background: "#0b0b0f",
          color: "#e6e6ea",
          lineHeight: 1.6,
        }}
      >
        {children}
      </body>
    </html>
  );
}
