/**
 * Treasury → every custodial wallet: top up native SOL to the reserve floor (0.001 SOL).
 * Matches Worker `CUSTODIAL_SOL_RESERVE_LAMPORTS` / daily RRTT cron SOL top-up.
 *
 *   node scripts/fund-custodial-sol-all.mjs           # dry-run
 *   node scripts/fund-custodial-sol-all.mjs --live    # send txs
 *
 * Env: `custodial-script-env.mjs` + RRTT_TREASURY_SECRET_KEY_B58, Cloudflare creds for D1.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { loadCustodialScriptEnv } from "./custodial-script-env.mjs";
import bs58 from "bs58";
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

/** Same as `src/custodial-sol-reserve.ts` — 0.001 SOL */
const CUSTODIAL_SOL_RESERVE_LAMPORTS = 1_000_000;

const EXPECTED_TREASURY_PUBKEY = "G1DHctEcwkiLw8NZDfCbDCbuPktQBmWa6P2aobDuMKuZ";

const RPC_FALLBACKS = [
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
  "https://api.mainnet-beta.solana.com",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function rpcUrlCandidates() {
  const primary = String(process.env.SOLANA_RPC_URL || "").trim();
  const out = [];
  for (const u of [primary, ...RPC_FALLBACKS]) {
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

function fetchAllWalletPubkeysFromD1() {
  const sql = `SELECT account_id, pubkey FROM internal_solana_wallets ORDER BY created_at ASC`;
  const wranglerJs = join(WORKER_ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  if (!existsSync(wranglerJs)) throw new Error(`wrangler not found at ${wranglerJs}`);
  const out = execFileSync(process.execPath, [wranglerJs, "d1", "execute", "root-record", "--remote", "--json", "--command", sql], {
    cwd: WORKER_ROOT,
    encoding: "utf8",
    env: process.env,
    shell: false,
  });
  const jsonStart = out.indexOf("[");
  const jsonEnd = out.lastIndexOf("]");
  if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error("wrangler d1: no JSON");
  const parsed = JSON.parse(out.slice(jsonStart, jsonEnd + 1));
  const rows = parsed?.[0]?.results;
  if (!Array.isArray(rows)) throw new Error("unexpected d1 json");
  return rows.map((r) => ({
    account_id: String(r.account_id || "").trim(),
    pubkey: String(r.pubkey || "").trim(),
  }));
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

async function sendTreasuryTopUp(connection, treasury, toPk, lamports) {
  const latest = await connection.getLatestBlockhash("confirmed");
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
    SystemProgram.transfer({
      fromPubkey: treasury.publicKey,
      toPubkey: toPk,
      lamports,
    }),
  ];
  const msg = new TransactionMessage({
    payerKey: treasury.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([treasury]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction(
    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  return sig;
}

async function main() {
  const live = process.argv.includes("--live");
  loadCustodialScriptEnv(WORKER_ROOT, { requireInternalWalletKey: false });

  const hasCf =
    (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_API_TOKEN.length >= 10) ||
    (process.env.CLOUDFLARE_API_KEY && process.env.CLOUDFLARE_EMAIL && process.env.CLOUDFLARE_API_KEY.length >= 10);
  if (!hasCf) {
    throw new Error("Need CLOUDFLARE_API_TOKEN or CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY for D1.");
  }
  if (process.env.CLOUDFLARE_GLOBAL_API_KEY && !process.env.CLOUDFLARE_API_KEY) {
    process.env.CLOUDFLARE_API_KEY = process.env.CLOUDFLARE_GLOBAL_API_KEY;
  }

  const treasB58 = String(process.env.RRTT_TREASURY_SECRET_KEY_B58 || "").trim();
  if (!treasB58) throw new Error("RRTT_TREASURY_SECRET_KEY_B58 missing");
  let treasury;
  try {
    treasury = Keypair.fromSecretKey(bs58.decode(treasB58));
  } catch {
    throw new Error("RRTT_TREASURY_SECRET_KEY_B58 invalid bs58");
  }
  const treasuryPub = treasury.publicKey.toBase58();
  if (treasuryPub !== EXPECTED_TREASURY_PUBKEY) {
    throw new Error(`Treasury pubkey mismatch: got ${treasuryPub}, expected ${EXPECTED_TREASURY_PUBKEY}`);
  }

  const rows = fetchAllWalletPubkeysFromD1();
  const connection = await pickConnection();
  const treasuryBal = await connection.getBalance(treasury.publicKey, "confirmed");

  const plan = [];
  let totalSend = 0;
  for (const r of rows) {
    if (!r.account_id || !r.pubkey) {
      plan.push({ ...r, skipped: "empty row" });
      continue;
    }
    let pk;
    try {
      pk = new PublicKey(r.pubkey);
    } catch {
      plan.push({ ...r, skipped: "invalid pubkey" });
      continue;
    }
    const bal = await connection.getBalance(pk, "confirmed");
    const target = CUSTODIAL_SOL_RESERVE_LAMPORTS;
    if (bal >= target) {
      plan.push({
        account_id: r.account_id,
        pubkey: r.pubkey,
        balance_lamports_before: bal,
        send_lamports: 0,
        skipped: "already at or above reserve",
      });
      continue;
    }
    const send = target - bal;
    totalSend += send;
    plan.push({
      account_id: r.account_id,
      pubkey: r.pubkey,
      balance_lamports_before: bal,
      send_lamports: send,
    });
  }

  console.log(
    JSON.stringify(
      {
        treasury: treasuryPub,
        reserve_lamports: CUSTODIAL_SOL_RESERVE_LAMPORTS,
        treasury_balance_lamports: treasuryBal,
        wallets_scanned: rows.length,
        wallets_needing_top_up: plan.filter((p) => p.send_lamports > 0).length,
        total_lamports_to_send: totalSend,
        live,
        plan,
      },
      null,
      2,
    ),
  );

  const feePerTx = 12_000;
  if (!live) {
    if (treasuryBal < totalSend + feePerTx * plan.filter((p) => p.send_lamports > 0).length) {
      console.log(
        `WARN: treasury may be short for full run (have ${treasuryBal}, planned sends ${totalSend} + ~${feePerTx} fee each). Live run will fund in order until treasury is exhausted.`,
      );
    }
    console.log("DRY-RUN: add --live to broadcast.");
    return;
  }

  let confirmed = 0;
  let skippedTreasury = 0;
  for (const p of plan) {
    if (!p.send_lamports || p.send_lamports <= 0) continue;
    const tBal = await connection.getBalance(treasury.publicKey, "confirmed");
    if (tBal < p.send_lamports + feePerTx) {
      skippedTreasury += 1;
      console.log(
        JSON.stringify({
          ok: false,
          skipped: "treasury_insufficient",
          account_id: p.account_id,
          pubkey: p.pubkey,
          send_lamports: p.send_lamports,
          treasury_balance_lamports: tBal,
        }),
      );
      continue;
    }
    const toPk = new PublicKey(p.pubkey);
    try {
      const sig = await sendTreasuryTopUp(connection, treasury, toPk, p.send_lamports);
      confirmed += 1;
      console.log(JSON.stringify({ ok: true, account_id: p.account_id, pubkey: p.pubkey, send_lamports: p.send_lamports, signature: sig }));
    } catch (e) {
      console.log(
        JSON.stringify({
          ok: false,
          account_id: p.account_id,
          pubkey: p.pubkey,
          error: String(e?.message || e),
        }),
      );
    }
    await sleep(350);
  }
  console.log(JSON.stringify({ ok: true, transfers_confirmed: confirmed, skipped_treasury_short: skippedTreasury }, null, 2));
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
