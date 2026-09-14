/**
 * Send SOL from a custodial wallet (D1 `internal_solana_wallets`) to any pubkey.
 *
 * Default: send maximum spendable (balance minus rent-exempt minimum for 0-byte account + fee pad).
 * Optional: `--lamports N` for exact amount (must leave enough for fee + rent or tx fails).
 *
 *   node scripts/custodial-send-sol.mjs <from_pubkey> <to_pubkey>
 *   node scripts/custodial-send-sol.mjs <from_pubkey> <to_pubkey> --lamports 1000000 --live
 *
 * Env: `custodial-script-env.mjs` (same as burn script).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { loadCustodialScriptEnv } from "./custodial-script-env.mjs";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_ROOT = dirname(__dirname);

const RPC_FALLBACKS = [
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
  "https://api.mainnet-beta.solana.com",
];

function rpcUrlCandidates() {
  const primary = String(process.env.SOLANA_RPC_URL || "").trim();
  const out = [];
  for (const u of [primary, ...RPC_FALLBACKS]) {
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

function assertSafePubkeyB58(s) {
  const t = String(s || "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) {
    throw new Error("pubkey must be base58 (32–44 chars)");
  }
  return t;
}

function fetchWalletEncRowFromD1(pubkeyB58) {
  const safe = assertSafePubkeyB58(pubkeyB58);
  const sql = `SELECT account_id, hex(privkey_pkcs8_enc) AS enc_hex, hex(privkey_iv) AS iv_hex FROM internal_solana_wallets WHERE pubkey = '${safe}'`;
  const wranglerJs = join(WORKER_ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  if (!existsSync(wranglerJs)) {
    throw new Error(`wrangler CLI not found at ${wranglerJs}`);
  }
  const out = execFileSync(process.execPath, [wranglerJs, "d1", "execute", "root-record", "--remote", "--json", "--command", sql], {
    cwd: WORKER_ROOT,
    encoding: "utf8",
    env: process.env,
    shell: false,
  });
  const jsonStart = out.indexOf("[");
  const jsonEnd = out.lastIndexOf("]");
  if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error(`wrangler d1: no JSON in stdout`);
  const parsed = JSON.parse(out.slice(jsonStart, jsonEnd + 1));
  const row = parsed?.[0]?.results?.[0];
  if (!row?.enc_hex || !row?.iv_hex) {
    throw new Error(`No internal_solana_wallets row for pubkey ${safe}`);
  }
  return {
    account_id: String(row.account_id || "").trim(),
    enc_hex: String(row.enc_hex).trim(),
    iv_hex: String(row.iv_hex).trim(),
  };
}

function hexToUint8(hex) {
  const clean = hex.replace(/^0x/i, "");
  if (clean.length % 2 !== 0) throw new Error("invalid hex length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function importAesKeyFromEnv() {
  const b64 = String(process.env.INTERNAL_WALLET_ENC_KEY_B64 || "").trim();
  if (!b64) throw new Error("INTERNAL_WALLET_ENC_KEY_B64 missing");
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) throw new Error("INTERNAL_WALLET_ENC_KEY_B64 must decode to 32 bytes");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
}

async function decryptPkcs8(aesKey, encHex, ivHex) {
  const ct = hexToUint8(encHex);
  const iv = hexToUint8(ivHex);
  const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ct);
  const sk = new Uint8Array(ptBuf);
  if (sk.length === 64) return Keypair.fromSecretKey(sk);
  if (sk.length === 32) return Keypair.fromSeed(sk);
  throw new Error(`unexpected decrypted secret length ${sk.length}`);
}

async function pickConnection() {
  for (const url of rpcUrlCandidates()) {
    try {
      const c = new Connection(url, "confirmed");
      await c.getLatestBlockhash("confirmed");
      return c;
    } catch {
      /* next */
    }
  }
  throw new Error("no working RPC");
}

function parseLamportsArg(argv) {
  const i = argv.indexOf("--lamports");
  if (i < 0 || i + 1 >= argv.length) return null;
  const raw = String(argv[i + 1] || "").trim();
  if (!/^\d+$/.test(raw)) throw new Error("--lamports must be a positive integer (lamports)");
  const n = BigInt(raw);
  if (n <= 0n) throw new Error("--lamports must be positive");
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("--lamports too large for this script");
  return Number(n);
}

function positionalPubkeys(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") continue;
    if (a === "--lamports") {
      i += 1;
      continue;
    }
    if (a.startsWith("--")) continue;
    out.push(a);
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const live = argv.includes("--live");
  const filtered = positionalPubkeys(argv);
  const fromB58 = filtered[0];
  const toB58 = filtered[1];
  if (!fromB58 || !toB58) {
    console.error("Usage: node scripts/custodial-send-sol.mjs <from_custodial_pubkey> <to_pubkey> [--lamports N] [--live]");
    process.exit(1);
  }

  const lamportsOpt = parseLamportsArg(argv);

  try {
    loadCustodialScriptEnv(WORKER_ROOT);
  } catch (e) {
    console.error(e?.message || e);
    process.exit(1);
  }
  const hasCf =
    (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_API_TOKEN.length >= 10) ||
    (process.env.CLOUDFLARE_API_KEY && process.env.CLOUDFLARE_EMAIL && process.env.CLOUDFLARE_API_KEY.length >= 10);
  if (!hasCf) {
    console.error("Need CLOUDFLARE_API_TOKEN or CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY for D1.");
    process.exit(1);
  }
  if (process.env.CLOUDFLARE_GLOBAL_API_KEY && !process.env.CLOUDFLARE_API_KEY) {
    process.env.CLOUDFLARE_API_KEY = process.env.CLOUDFLARE_GLOBAL_API_KEY;
  }

  const row = fetchWalletEncRowFromD1(fromB58);
  const aesKey = await importAesKeyFromEnv();
  const kp = await decryptPkcs8(aesKey, row.enc_hex, row.iv_hex);
  if (kp.publicKey.toBase58() !== assertSafePubkeyB58(fromB58)) {
    throw new Error("decrypted key pubkey mismatch D1 row");
  }

  let toPk;
  try {
    toPk = new PublicKey(assertSafePubkeyB58(toB58));
  } catch {
    throw new Error("invalid to_pubkey");
  }

  const connection = await pickConnection();
  const balance = await connection.getBalance(kp.publicKey, "confirmed");
  const minBal = await connection.getMinimumBalanceForRentExemption(0);
  const feePad = 15_000;

  let sendLamports;
  if (lamportsOpt != null) {
    sendLamports = lamportsOpt;
  } else {
    sendLamports = balance - minBal - feePad;
  }

  console.log(
    JSON.stringify(
      {
        account_id: row.account_id,
        from: kp.publicKey.toBase58(),
        to: toPk.toBase58(),
        balance_lamports: balance,
        min_rent_exempt_0_lamports: minBal,
        fee_pad_lamports: feePad,
        send_lamports: sendLamports,
        live,
      },
      null,
      2,
    ),
  );

  if (sendLamports <= 0) {
    console.error("Nothing to send (balance too low or --lamports too high).");
    process.exit(1);
  }

  if (!live) {
    console.log("DRY-RUN: add --live to broadcast.");
    process.exit(0);
  }

  const latest = await connection.getLatestBlockhash("confirmed");
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
    SystemProgram.transfer({
      fromPubkey: kp.publicKey,
      toPubkey: toPk,
      lamports: sendLamports,
    }),
  ];
  const msg = new TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([kp]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction(
    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  console.log(JSON.stringify({ ok: true, signature: sig, send_lamports: sendLamports }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
