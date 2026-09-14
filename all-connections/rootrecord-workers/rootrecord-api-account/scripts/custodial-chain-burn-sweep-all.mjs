/**
 * Global custodial cleanup:
 * 1) Order wallets that still have SPL token accounts by on-chain SOL (highest first).
 * 2) Walk that list: if the wallet cannot pay fees, fund it from treasury (first) or from the
 *    previous wallet in the list after it has burned/closed (then treasury top-up if still short).
 * 3) Burn + close every SPL ATA (rent stays on custodial until forwarded).
 * 4) Forward max SOL to the next token-bearing wallet; the last forwards to treasury.
 * 5) Final pass: every custodial with spendable SOL sends max to treasury.
 *
 * Secrets: see `custodial-script-env.mjs` (reads existing `credentials.env` / `.env` only).
 *   INTERNAL_WALLET_ENC_KEY_B64, RRTT_TREASURY_SECRET_KEY_B58 (bs58),
 *   CLOUDFLARE_API_TOKEN or CLOUDFLARE_EMAIL+CLOUDFLARE_API_KEY,
 *   SOLANA_RPC_URL (optional; fallbacks built-in)
 *
 *   node scripts/custodial-chain-burn-sweep-all.mjs           # dry-run plan + RPC snapshot
 *   node scripts/custodial-chain-burn-sweep-all.mjs --live    # execute (slow; many txs)
 *   node scripts/custodial-chain-burn-sweep-all.mjs --live --limit 5
 *
 * Env tuning (optional):
 *   CUSTODIAL_SWEEP_FUND_LAMPORTS  — min lamports to have before burn pass (default 2_500_000)
 *   CUSTODIAL_SWEEP_FEE_PAD        — lamports kept on sender after forward (default 25_000)
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

const DEFAULT_FUND_FLOOR = 2_500_000;
const DEFAULT_FEE_PAD = 25_000;

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

function fundFloorLamports() {
  const n = Number(process.env.CUSTODIAL_SWEEP_FUND_LAMPORTS || DEFAULT_FUND_FLOOR);
  return Number.isFinite(n) && n > 500_000 ? Math.floor(n) : DEFAULT_FUND_FLOOR;
}

function feePadLamports() {
  const n = Number(process.env.CUSTODIAL_SWEEP_FEE_PAD || DEFAULT_FEE_PAD);
  return Number.isFinite(n) && n > 5_000 ? Math.floor(n) : DEFAULT_FEE_PAD;
}

function fetchAllWalletEncRowsFromD1() {
  const sql = `SELECT account_id, pubkey, hex(privkey_pkcs8_enc) AS enc_hex, hex(privkey_iv) AS iv_hex FROM internal_solana_wallets ORDER BY created_at ASC`;
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
    enc_hex: String(r.enc_hex || "").trim(),
    iv_hex: String(r.iv_hex || "").trim(),
  }));
}

function hexToUint8(hex) {
  const clean = String(hex).replace(/^0x/i, "");
  if (clean.length % 2 !== 0) throw new Error("invalid hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function importAesKeyFromEnv() {
  const b64 = String(process.env.INTERNAL_WALLET_ENC_KEY_B64 || "").trim();
  if (!b64) throw new Error("INTERNAL_WALLET_ENC_KEY_B64 missing");
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) throw new Error("INTERNAL_WALLET_ENC_KEY_B64 must be 32 bytes");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
}

async function decryptPkcs8(aesKey, encHex, ivHex) {
  const ct = hexToUint8(encHex);
  const iv = hexToUint8(ivHex);
  const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ct);
  const sk = new Uint8Array(ptBuf);
  if (sk.length === 64) return Keypair.fromSecretKey(sk);
  if (sk.length === 32) return Keypair.fromSeed(sk);
  throw new Error(`bad sk len ${sk.length}`);
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

async function loadTokenAccounts(connection, ownerPk) {
  const batch = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const r = await connection.getParsedTokenAccountsByOwner(ownerPk, { programId });
    batch.push(...collectParsedTokenAccounts(ownerPk, programId, r.value));
  }
  return batch;
}

async function refreshSol(connection, kp) {
  return connection.getBalance(kp.publicKey, "confirmed");
}

async function sendSolTransfer(connection, fromKp, toPubkey, lamports, log) {
  if (lamports <= 0) return null;
  const latest = await connection.getLatestBlockhash("confirmed");
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
    SystemProgram.transfer({ fromPubkey: fromKp.publicKey, toPubkey: toPubkey, lamports }),
  ];
  const msg = new TransactionMessage({
    payerKey: fromKp.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([fromKp]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction(
    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  if (log) console.log(log, sig);
  return sig;
}

async function burnCloseOne(connection, custodialKp, acc, destRent) {
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
  ];
  if (acc.amount > 0n) {
    ixs.push(
      createBurnCheckedInstruction(acc.pubkey, acc.mint, custodialKp.publicKey, acc.amount, acc.decimals, [], acc.tokenProgram),
    );
  }
  ixs.push(createCloseAccountInstruction(acc.pubkey, destRent, custodialKp.publicKey, [], acc.tokenProgram));
  const latest = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: custodialKp.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([custodialKp]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction(
    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  return sig;
}

async function burnCloseAllForWallet(connection, w) {
  const destRent = w.kp.publicKey;
  const sigs = [];
  let tokens = await loadTokenAccounts(connection, w.kp.publicKey);
  let guard = 0;
  while (tokens.length > 0 && guard < 64) {
    guard += 1;
    for (const acc of tokens) {
      const sig = await burnCloseOne(connection, w.kp, acc, destRent);
      sigs.push(sig);
      await sleep(400);
    }
    tokens = await loadTokenAccounts(connection, w.kp.publicKey);
  }
  return sigs;
}

async function main() {
  const argv = process.argv.slice(2);
  const live = argv.includes("--live");
  let limit = null;
  const eqArg = argv.find((a) => a.startsWith("--limit="));
  if (eqArg) limit = Math.max(1, Math.min(100_000, Number(eqArg.split("=")[1]) || 0));
  const li = argv.indexOf("--limit");
  if (li >= 0 && argv[li + 1] && !argv[li + 1].startsWith("--")) {
    limit = Math.max(1, Math.min(100_000, Number(argv[li + 1]) || 0));
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
    console.error("Need Cloudflare credentials for D1.");
    process.exit(1);
  }
  if (process.env.CLOUDFLARE_GLOBAL_API_KEY && !process.env.CLOUDFLARE_API_KEY) {
    process.env.CLOUDFLARE_API_KEY = process.env.CLOUDFLARE_GLOBAL_API_KEY;
  }

  const treasB58 = String(process.env.RRTT_TREASURY_SECRET_KEY_B58 || "").trim();
  let treasury = null;
  if (treasB58) {
    try {
      treasury = Keypair.fromSecretKey(bs58.decode(treasB58));
    } catch {
      console.error("RRTT_TREASURY_SECRET_KEY_B58 invalid bs58.");
      process.exit(1);
    }
  } else if (live) {
    console.error("RRTT_TREASURY_SECRET_KEY_B58 missing (required for --live).");
    process.exit(1);
  }

  const FUND_FLOOR = fundFloorLamports();
  const FEE_PAD = feePadLamports();

  const aesKey = await importAesKeyFromEnv();
  const d1Rows = fetchAllWalletEncRowsFromD1();
  const slice = limit ? d1Rows.slice(0, limit) : d1Rows;

  const wallets = [];
  let decryptFail = 0;
  for (const row of slice) {
    if (!row.account_id || !row.pubkey || !row.enc_hex || !row.iv_hex) continue;
    try {
      const kp = await decryptPkcs8(aesKey, row.enc_hex, row.iv_hex);
      if (kp.publicKey.toBase58() !== row.pubkey) {
        decryptFail += 1;
        continue;
      }
      wallets.push({ account_id: row.account_id, pubkey: row.pubkey, kp });
    } catch {
      decryptFail += 1;
    }
  }

  const connection = await pickConnection();
  const minRent = await connection.getMinimumBalanceForRentExemption(0);

  for (const w of wallets) {
    w.sol = await refreshSol(connection, w.kp);
    w.tokens = await loadTokenAccounts(connection, w.kp.publicKey);
    await sleep(80);
  }

  const withTokens = wallets.filter((w) => w.tokens.length > 0).sort((a, b) => b.sol - a.sol || a.account_id.localeCompare(b.account_id));

  const plan = {
    dry_run: !live,
    d1_rows: slice.length,
    wallets_unlocked: wallets.length,
    decrypt_failures: decryptFail,
    fund_floor_lamports: FUND_FLOOR,
    fee_pad_lamports: FEE_PAD,
    min_rent_0: minRent,
    treasury: treasury ? treasury.publicKey.toBase58() : null,
    token_holder_count: withTokens.length,
    token_holders_order: withTokens.map((w) => ({
      account_id: w.account_id,
      pubkey: w.pubkey,
      sol_lamports: w.sol,
      token_accounts: w.tokens.length,
    })),
    custodials_any_sol: wallets.filter((w) => w.sol > minRent + FEE_PAD).length,
    richest_custodial_pubkey:
      wallets.length === 0
        ? null
        : wallets.slice().sort((a, b) => b.sol - a.sol || a.pubkey.localeCompare(b.pubkey))[0].pubkey,
  };
  console.log(JSON.stringify({ phase: "plan", plan }, null, 2));

  if (!live) {
    const toTreasuryEst = wallets.reduce((s, w) => s + Math.max(0, w.sol - minRent - FEE_PAD), 0);
    console.log(
      JSON.stringify(
        {
          note: "DRY-RUN only. Re-run with --live to execute. Optional: --limit=N",
          est_spendable_to_treasury_if_already_clean_lamports: toTreasuryEst,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  const treasuryPk = treasury.publicKey;
  const txLog = [];

  async function pickRichestDonor(excludePk) {
    let best = null;
    let bestSol = -1;
    for (const o of wallets) {
      if (o.pubkey === excludePk) continue;
      const s = await refreshSol(connection, o.kp);
      if (s > bestSol) {
        bestSol = s;
        best = o;
      }
    }
    return bestSol > minRent + FEE_PAD + 10_000 ? best : null;
  }

  /** @param {{ prevWallet: unknown, starterWallet: unknown }} opts */
  async function ensureFunded(w, opts) {
    const prevWallet = opts?.prevWallet || null;
    const starterWallet = opts?.starterWallet || null;
    let sol = await refreshSol(connection, w.kp);
    if (sol >= FUND_FLOOR) return;

    async function pullFromDonor(donor, tag) {
      if (!donor || donor.pubkey === w.pubkey) return;
      const need = FUND_FLOOR - (await refreshSol(connection, w.kp)) + 50_000;
      if (need <= 0) return;
      const donorSol = await refreshSol(connection, donor.kp);
      const can = donorSol - minRent - FEE_PAD;
      const send1 = Math.min(need, Math.max(0, can));
      if (send1 <= 0) return;
      const s = await sendSolTransfer(connection, donor.kp, w.kp.publicKey, send1, tag);
      txLog.push({ kind: tag, from: donor.pubkey, to: w.pubkey, lamports: send1, sig: s });
      await sleep(400);
    }

    await pullFromDonor(prevWallet, "fund_from_prev");
    let solMid = await refreshSol(connection, w.kp);
    if (solMid >= FUND_FLOOR) return;
    await pullFromDonor(
      starterWallet && starterWallet.pubkey !== w.pubkey ? starterWallet : null,
      "fund_from_starter",
    );
    solMid = await refreshSol(connection, w.kp);
    if (solMid >= FUND_FLOOR) return;

    const still = FUND_FLOOR - solMid + 50_000;
    const tBal = await refreshSol(connection, treasury);
    if (tBal < still + minRent + 100_000) {
      throw new Error(`treasury SOL too low: have ${tBal} need ~${still}`);
    }
    const s = await sendSolTransfer(connection, treasury, w.kp.publicKey, still, "fund_from_treasury");
    txLog.push({ kind: "fund_from_treasury", to: w.pubkey, lamports: still, sig: s });
    await sleep(400);
  }

  const starterSnapshot =
    wallets.length === 0 ? null : wallets.slice().sort((a, b) => b.sol - a.sol || a.pubkey.localeCompare(b.pubkey))[0];

  let prev = null;
  for (let i = 0; i < withTokens.length; i++) {
    const w = withTokens[i];
    const starterForFirst =
      i === 0 && starterSnapshot && starterSnapshot.pubkey !== w.pubkey ? starterSnapshot : null;
    await ensureFunded(w, {
      prevWallet: i === 0 ? null : prev,
      starterWallet: starterForFirst,
    });
    const sigs = await burnCloseAllForWallet(connection, w);
    for (const s of sigs) txLog.push({ kind: "burn_close", wallet: w.pubkey, sig: s });
    await sleep(300);
    const next = withTokens[i + 1];
    const solAfter = await refreshSol(connection, w.kp);
    const reserve = minRent + FEE_PAD;
    const forward = next ? solAfter - reserve : solAfter - reserve;
    if (forward > 0) {
      const to = next ? next.kp.publicKey : treasuryPk;
      const s = await sendSolTransfer(connection, w.kp, to, forward, next ? "forward_to_next" : "forward_to_treasury");
      txLog.push({ kind: next ? "forward_to_next" : "forward_to_treasury", from: w.pubkey, lamports: forward, sig: s });
    }
    prev = w;
    await sleep(300);
  }

  for (const w of wallets) {
    let tokens = await loadTokenAccounts(connection, w.kp.publicKey);
    if (tokens.length === 0) continue;
    const donor = await pickRichestDonor(w.pubkey);
    await ensureFunded(w, { prevWallet: null, starterWallet: donor });
    const sigs = await burnCloseAllForWallet(connection, w);
    for (const s of sigs) txLog.push({ kind: "burn_close_late", wallet: w.pubkey, sig: s });
    await sleep(250);
  }

  let totalToTreasury = 0n;
  for (const w of wallets) {
    const sol = await refreshSol(connection, w.kp);
    const send = sol - minRent - FEE_PAD;
    if (send <= 0) continue;
    const s = await sendSolTransfer(connection, w.kp, treasuryPk, send, "final_sweep_to_treasury");
    txLog.push({ kind: "final_sweep_to_treasury", from: w.pubkey, lamports: send, sig: s });
    await sleep(300);
  }

  for (const e of txLog) {
    if ((e.kind === "forward_to_treasury" || e.kind === "final_sweep_to_treasury") && e.lamports) {
      totalToTreasury += BigInt(e.lamports);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        total_to_treasury_lamports: String(totalToTreasury),
        treasury: treasuryPk.toBase58(),
        tx_count: txLog.length,
        tx_log: txLog,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
