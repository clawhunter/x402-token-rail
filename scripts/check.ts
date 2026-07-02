// Runnable proof for the two primitives that touch the real world — the free
// oracle and the NEW holder gate — WITHOUT needing a paying x402 client.
//
//   npx tsx scripts/check.ts [mint] [wallet]
//
// Defaults to the CLAWHUNTER mint. Pass a wallet to also run a live holder check.
// This hits mainnet (Dexscreener + a Solana RPC), so it needs network.

import {
  createDexscreenerOracle,
  createDynamicPrice,
  createHolderGate,
  wholeTokens,
} from "../token-rail/index";

const MINT = process.argv[2] || "6GGY8GViCR5v4xR4Lxb4nfiAJsEoJua5Gj6YecxbJ4BQ";
const WALLET = process.argv[3];
const DECIMALS = Number(process.env.TOKEN_DECIMALS) || 6;
const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const DISCOUNT = Number(process.env.TOKEN_DISCOUNT ?? "0.2");
const HOLDER_MIN = Number(process.env.HOLDER_MIN_TOKENS) || 100_000;

async function main() {
  console.log(`\nmint:     ${MINT}`);
  console.log(`decimals: ${DECIMALS}\n`);

  // 1) Default free oracle → live USD price.
  const oracle = createDexscreenerOracle(MINT);
  const usd = await oracle();
  console.log(`[oracle] live USD price: ${usd === null ? "UNAVAILABLE" : `$${usd}`}`);
  if (usd === null) {
    console.log("  (Dexscreener missed — set TOKEN_USD_FALLBACK for production)");
  }

  // 2) Dynamic price → what a $0.01 endpoint costs in the token, discounted.
  const price = createDynamicPrice({
    mint: MINT,
    decimals: DECIMALS,
    discount: DISCOUNT,
    getUsdPrice: oracle,
  });
  try {
    const { amount } = await price(0.01);
    const whole = Number(amount) / 10 ** DECIMALS;
    console.log(
      `[price]  a $0.01 endpoint costs ${amount} atomic (${whole} tokens) at ${Math.round(
        DISCOUNT * 100,
      )}% off`,
    );
  } catch (e) {
    console.log(`[price]  unavailable: ${(e as Error).message}`);
  }

  // 3) Holder gate — live on-chain balance (only if a wallet was passed).
  if (WALLET) {
    const gate = createHolderGate({
      rpc: RPC,
      mint: MINT,
      minBalance: wholeTokens(HOLDER_MIN, DECIMALS),
    });
    const balance = await gate.balanceOf(WALLET);
    const isHolder = await gate.isHolder(WALLET);
    const whole = Number(balance) / 10 ** DECIMALS;
    console.log(`\n[gate]   wallet:  ${WALLET}`);
    console.log(`[gate]   balance: ${balance} atomic (${whole} tokens)`);
    console.log(`[gate]   isHolder (≥ ${HOLDER_MIN.toLocaleString("en-US")}): ${isHolder}`);
  } else {
    console.log("\n[gate]   skipped — pass a wallet as the 2nd arg to run a live holder check");
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
