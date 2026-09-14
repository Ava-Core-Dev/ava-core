/**
 * For one custodial wallet row: burn full SPL balance on each token account, then close the ATA
 * (rent lamports return to `destination_base58`, default = custodial owner).
 *
 * Prerequisites: see `custodial-script-env.mjs` (reads existing env files only).
 *   INTERNAL_WALLET_ENC_KEY_B64 — same 32-byte AES-GCM key as the Worker
 *   CLOUDFLARE_API_TOKEN (or email + global API key) — for `wrangler d1 execute --remote`
 *   SOLANA_RPC_URL — optional; public fallbacks used if primary fails
 *
 * Usage (from rootrecord-api-account):
 *   node scripts/custodial-burn-close-all-token-accounts.mjs <custodial_pubkey_base58>
 *   node scripts/custodial-burn-close-all-token-accounts.mjs <custodial_pubkey_base58> --live
 *
 * Default is dry-run (lists parsed token accounts, no txs).
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
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createBurnCheckedInstruction,
  createCloseAccountInstruction,
} from "@solana/spl-token";

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
    throw new Error("custodial pubkey must be base58 (32–44 chars), no quotes");
  }
  return t;
}

function fetchWalletEncRowFromD1(pubkeyB58) {
  const safe = assertSafePubkeyB58(pubkeyB58);
  const sql = `SELECT account_id, hex(privkey_pkcs8_enc) AS enc_hex, hex(privkey_iv) AS iv_hex FROM internal_solana_wallets WHERE pubkey = '${safe}'`;
  const wranglerJs = join(WORKER_ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  if (!existsSync(wranglerJs)) {
    throw new Error(`wrangler CLI not found at ${wranglerJs} (run npm ci in rootrecord-api-account).`);
  }
  const out = execFileSync(process.execPath, [wranglerJs, "d1", "execute", "root-record", "--remote", "--json", "--command", sql], {
    cwd: WORKER_ROOT,
    encoding: "utf8",
    env: process.env,
    shell: false,
  });
  const jsonStart = out.indexOf("[");
  const jsonEnd = out.lastIndexOf("]");
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    throw new Error(`wrangler d1: no JSON in stdout`);
  }
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

function collectParsedTokenAccounts(owner, programId, value) {
  const out = [];
  for (const row of value || []) {
    const raw = row.account.data;
    if (typeof raw !== "object" || raw === null || !("parsed" in raw)) continue;
    const parsed = raw.parsed;
    if (!parsed || parsed.type !== "account" || !parsed.info) continue;
    const info = parsed.info;
    const mintStr = String(info.mint || "").trim();
    const ownerStr = String(info.owner || "").trim();
    if (!mintStr || !ownerStr) continue;
    let mint;
    let tokOwner;
    try {
      mint = new PublicKey(mintStr);
      tokOwner = new PublicKey(ownerStr);
    } catch {
      continue;
    }
    if (!tokOwner.equals(owner)) continue;
    const amount = BigInt(String(info.tokenAmount?.amount ?? "0"));
    const decimals = Math.min(9, Math.max(0, Math.floor(Number(info.tokenAmount?.decimals) || 0)));
    out.push({ pubkey: row.pubkey, mint, amount, decimals, tokenProgram: programId });
  }
  return out;
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

async function main() {
  const argv = process.argv.slice(2);
  const live = argv.includes("--live");
  const pos = argv.filter((a) => !a.startsWith("--"));
  const pubkeyB58 = pos[0];
  if (!pubkeyB58) {
    console.error("Usage: node scripts/custodial-burn-close-all-token-accounts.mjs <custodial_pubkey> [--live]");
    process.exit(1);
  }

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

  const row = fetchWalletEncRowFromD1(pubkeyB58);
  const aesKey = await importAesKeyFromEnv();
  const kp = await decryptPkcs8(aesKey, row.enc_hex, row.iv_hex);
  if (kp.publicKey.toBase58() !== assertSafePubkeyB58(pubkeyB58)) {
    throw new Error("decrypted key pubkey mismatch D1 row");
  }

  const destRent = kp.publicKey;
  const connection = await pickConnection();

  const batch = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const r = await connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId });
    batch.push(...collectParsedTokenAccounts(kp.publicKey, programId, r.value));
  }

  console.log(
    JSON.stringify(
      {
        account_id: row.account_id,
        pubkey: kp.publicKey.toBase58(),
        live,
        token_accounts: batch.map((b) => ({
          token_account: b.pubkey.toBase58(),
          mint: b.mint.toBase58(),
          amount_raw: String(b.amount),
          decimals: b.decimals,
          program: b.tokenProgram.toBase58(),
        })),
      },
      null,
      2,
    ),
  );

  if (batch.length === 0) {
    console.log("No SPL token accounts under this owner.");
    process.exit(0);
    return;
  }

  if (!live) {
    console.log("DRY-RUN: pass --live to sign and send one tx per account (burn if needed, then close).");
    process.exit(0);
    return;
  }

  const signatures = [];
  for (const acc of batch) {
    const ixs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
    ];
    if (acc.amount > 0n) {
      ixs.push(
        createBurnCheckedInstruction(acc.pubkey, acc.mint, kp.publicKey, acc.amount, acc.decimals, [], acc.tokenProgram),
      );
    }
    ixs.push(createCloseAccountInstruction(acc.pubkey, destRent, kp.publicKey, [], acc.tokenProgram));

    const latest = await connection.getLatestBlockhash("confirmed");
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
    signatures.push({ token_account: acc.pubkey.toBase58(), signature: sig });
    console.log("ok", acc.pubkey.toBase58(), sig);
  }

  console.log(JSON.stringify({ done: true, signatures }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
