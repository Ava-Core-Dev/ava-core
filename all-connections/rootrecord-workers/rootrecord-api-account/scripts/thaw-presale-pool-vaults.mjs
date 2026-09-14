/**
 * Thaw the two Raydium pool vault token accounts (SOL + USDC legs) at public market open.
 * Uses the same freeze authority + credentials.env discovery as `freeze-new-token-accounts.mjs`.
 *
 *   node scripts/thaw-presale-pool-vaults.mjs           # dry-run
 *   node scripts/thaw-presale-pool-vaults.mjs --live   # sign + send
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createThawAccountInstruction,
  unpackAccount,
} from "@solana/spl-token";
import bs58 from "bs58";

const VAULT_SOL = "GjUnPAYqf3NQL5dDBDH2TdmgkSe53AdaXwDggxFKFryz";
const VAULT_USDC = "B5AZM1c9oPDUUY4bgyaEYNaGHbnPDXGp1qDqQeU1w9KW";

const RPC_FALLBACKS = [
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
  "https://api.mainnet-beta.solana.com",
];

const __dirname = dirname(fileURLToPath(import.meta.url));

function findCredentialsEnv(start) {
  let probe = start;
  for (let i = 0; i <= 16; i++) {
    const candidate = join(probe, "credentials.env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(probe);
    if (!parent || parent === probe) break;
    probe = parent;
  }
  return null;
}

function loadEnvFile(path) {
  const text = readFileSync(path, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

function pickRpc() {
  return (
    process.env.SOLANA_RPC_URL ||
    process.env.HELIUS_RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    RPC_FALLBACKS[0]
  );
}

async function main() {
  const live = process.argv.includes("--live");
  const cred = findCredentialsEnv(__dirname);
  if (!cred) throw new Error("credentials.env not found (walk parents from script dir).");
  loadEnvFile(cred);

  const sec = String(process.env.RRTT_FREEZE_AUTHORITY_SECRET_B58 || "").trim();
  if (!sec) throw new Error("RRTT_FREEZE_AUTHORITY_SECRET_B58 missing in credentials.env");

  const kp = Keypair.fromSecretKey(bs58.decode(sec));
  const conn = new Connection(pickRpc(), "confirmed");
  const vaults = [VAULT_SOL, VAULT_USDC].map((s) => new PublicKey(s));

  const ixs = [];
  for (const addr of vaults) {
    const info = await conn.getAccountInfo(addr, "confirmed");
    if (!info) {
      console.error("missing account", addr.toBase58());
      continue;
    }
    const programId = info.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;
    const tokenAcc = unpackAccount(addr, info, programId);
    ixs.push(
      createThawAccountInstruction(addr, tokenAcc.mint, kp.publicKey, [], programId),
    );
  }

  if (ixs.length === 0) {
    console.log("nothing to thaw");
    return;
  }

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([kp]);

  if (!live) {
    console.log("DRY-RUN: would thaw", ixs.length, "vault(s); run with --live to send");
    return;
  }

  const sig = await conn.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  console.log("thaw ok", sig);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
