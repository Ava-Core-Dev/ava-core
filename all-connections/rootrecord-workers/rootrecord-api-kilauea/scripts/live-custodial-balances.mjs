/**
 * Live mainnet SOL + RRTT (mint) balances for every `internal_solana_wallets` row.
 * Loads repo-root `credentials.env` then `Web/credentials.env` (same walk as freeze script).
 * Uses `SOLANA_RPC_URL` (e.g. Helius) + public fallbacks. D1 list via `wrangler d1 execute --remote`
 * (needs CLOUDFLARE_API_TOKEN or CLOUDFLARE_EMAIL + CLOUDFLARE_GLOBAL_API_KEY in env / credentials).
 *
 * Usage (from rootrecord-primary):
 *   node scripts/live-custodial-balances.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { Connection, PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_ROOT = dirname(__dirname);

const DEFAULT_MINT_B58 = "6KfGKe13ASrV5WHvChbapQXxxEFRNqwpwrdEVsX6RQMT";
const DEFAULT_DECIMALS = 9;
const RPC_FALLBACKS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
];

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
    if (!(k in process.env) || !String(process.env[k]).trim()) process.env[k] = v;
  }
}

function mergeWebCredentials(repoRoot) {
  const web = join(repoRoot, "Web", "credentials.env");
  if (existsSync(web)) loadEnvFile(web);
}

function isLikelyInfraRpcError(e) {
  const s = e instanceof Error ? e.message : String(e);
  return /429|503|504|408|ECONNRESET|ETIMEDOUT|fetch failed|Too many|rate limit|socket hang|network/i.test(s);
}

function rpcUrlCandidates() {
  const primary = String(process.env.SOLANA_RPC_URL || "").trim();
  const out = [];
  for (const u of [primary, ...RPC_FALLBACKS]) {
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

async function sumMintRawForOwner(connection, mint, owner) {
  let totalRaw = 0n;
  let anyRpcSuccess = false;
  let infraFailures = 0;
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const { value } = await connection.getParsedTokenAccountsByOwner(owner, { programId });
      anyRpcSuccess = true;
      for (const row of value || []) {
        const raw = row.account.data;
        if (typeof raw !== "object" || raw === null || !("parsed" in raw)) continue;
        const parsed = raw.parsed;
        if (!parsed || parsed.type !== "account" || !parsed.info) continue;
        const info = parsed.info;
        const mintStr = String(info.mint || "").trim();
        const ownerStr = String(info.owner || "").trim();
        if (!mintStr || !ownerStr) continue;
        let accMint;
        let accOwner;
        try {
          accMint = new PublicKey(mintStr);
          accOwner = new PublicKey(ownerStr);
        } catch {
          continue;
        }
        if (!accMint.equals(mint) || !accOwner.equals(owner)) continue;
        totalRaw += BigInt(String(info.tokenAmount?.amount ?? "0"));
      }
    } catch (e) {
      if (isLikelyInfraRpcError(e)) infraFailures += 1;
    }
  }
  if (!anyRpcSuccess && infraFailures > 0) return { totalRaw: 0n, ok: false };
  return { totalRaw, ok: anyRpcSuccess };
}

async function tokenBalanceViaAta(connection, mint, custodialPk, decimals) {
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const ata = getAssociatedTokenAddressSync(mint, custodialPk, false, programId, ASSOCIATED_TOKEN_PROGRAM_ID);
      const bal = await connection.getTokenAccountBalance(ata);
      if (!bal?.value) continue;
      const ui = bal.value.uiAmount;
      if (ui != null && Number.isFinite(ui)) {
        return { whole: Math.max(0, Math.floor(ui)), ok: true };
      }
      if (bal.value.amount != null) {
        const raw = BigInt(String(bal.value.amount));
        const div = BigInt(10) ** BigInt(decimals);
        const whole = div > 0n ? raw / div : raw;
        return { whole: Math.max(0, Number(whole)), ok: true };
      }
    } catch (e) {
      if (isLikelyInfraRpcError(e)) return { whole: null, ok: false };
    }
  }
  return { whole: 0, ok: true };
}

function rawToWholeUnits(totalRaw, decimals) {
  const d = Math.min(9, Math.max(0, Math.floor(Number(decimals) || 9)));
  const div = BigInt(10) ** BigInt(d);
  if (div <= 0n) return Math.max(0, Number(totalRaw));
  const whole = totalRaw / div;
  if (whole > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Number(whole));
}

async function readLiveOnce(rpcUrl, mintStr, pkStr, decimals) {
  const connection = new Connection(rpcUrl, "confirmed");
  const mint = new PublicKey(mintStr);
  const custodialPk = new PublicKey(pkStr);

  let sol = 0;
  let solOk = false;
  try {
    sol = await connection.getBalance(custodialPk, "confirmed");
    solOk = true;
  } catch (e) {
    if (!isLikelyInfraRpcError(e)) throw e;
  }

  let rrtt = null;
  const scan = await sumMintRawForOwner(connection, mint, custodialPk);
  let tokenOk = scan.ok;
  if (tokenOk) {
    rrtt = rawToWholeUnits(scan.totalRaw, decimals);
  } else {
    const fb = await tokenBalanceViaAta(connection, mint, custodialPk, decimals);
    tokenOk = fb.ok;
    if (fb.ok && fb.whole != null) rrtt = fb.whole;
  }

  return { rrtt, sol, solOk, tokenOk };
}

async function readLiveWithFallbacks(mintStr, pkStr, decimals) {
  const urls = rpcUrlCandidates();
  let lastErr = null;
  for (const url of urls) {
    try {
      const r = await readLiveOnce(url, mintStr, pkStr, decimals);
      if (r.solOk || r.tokenOk) return { ...r, rpcHost: new URL(url).host };
    } catch (e) {
      lastErr = e;
    }
  }
  return {
    rrtt: null,
    sol: 0,
    solOk: false,
    tokenOk: false,
    rpcHost: urls[0] ? new URL(urls[0]).host : "",
    error: lastErr ? String(lastErr instanceof Error ? lastErr.message : lastErr) : "all RPC failed",
  };
}

function fetchCustodialRowsFromD1() {
  const sql = `SELECT la.email, iw.pubkey AS custodial_pubkey FROM internal_solana_wallets iw LEFT JOIN license_accounts la ON la.id = iw.account_id ORDER BY la.email COLLATE NOCASE`;
  const wranglerJs = join(WORKER_ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  if (!existsSync(wranglerJs)) {
    throw new Error(`wrangler CLI not found at ${wranglerJs} (run npm ci in rootrecord-primary).`);
  }
  /** `shell: false` so Windows cmd does not split `--command` on commas. */
  const out = execFileSync(
    process.execPath,
    [wranglerJs, "d1", "execute", "root-record", "--remote", "--json", "--command", sql],
    {
      cwd: WORKER_ROOT,
      encoding: "utf8",
      env: process.env,
      shell: false,
    },
  );
  const jsonStart = out.indexOf("[");
  const jsonEnd = out.lastIndexOf("]");
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    throw new Error(`wrangler d1: no JSON array in stdout (first 500 chars): ${out.slice(0, 500)}`);
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(out.slice(jsonStart, jsonEnd + 1));
  } catch {
    throw new Error(`wrangler d1 JSON parse failed (snippet): ${out.slice(jsonStart, jsonStart + 400)}`);
  }
  if (!Array.isArray(parsed) || !parsed[0]?.results) {
    throw new Error(`unexpected wrangler JSON shape`);
  }
  return parsed[0].results;
}

async function main() {
  const credPath = findCredentialsEnv(WORKER_ROOT);
  if (!credPath) {
    console.error("credentials.env not found (walk parents from worker root).");
    process.exit(1);
  }
  loadEnvFile(credPath);
  mergeWebCredentials(dirname(credPath));

  const mint = String(process.env.RRTT_MINT_BASE58 || DEFAULT_MINT_B58).trim();
  const decimals = Math.min(9, Math.max(0, Math.floor(Number(process.env.RRTT_DECIMALS || DEFAULT_DECIMALS) || 9)));

  const hasCf =
    (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_API_TOKEN.length >= 10) ||
    (process.env.CLOUDFLARE_API_KEY &&
      process.env.CLOUDFLARE_EMAIL &&
      process.env.CLOUDFLARE_API_KEY.length >= 10);
  if (!hasCf) {
    console.error("Need CLOUDFLARE_API_TOKEN or CLOUDFLARE_EMAIL + CLOUDFLARE_GLOBAL_API_KEY (mapped to CLOUDFLARE_API_KEY) for D1.");
    process.exit(1);
  }
  if (process.env.CLOUDFLARE_GLOBAL_API_KEY && !process.env.CLOUDFLARE_API_KEY) {
    process.env.CLOUDFLARE_API_KEY = process.env.CLOUDFLARE_GLOBAL_API_KEY;
  }

  const rows = fetchCustodialRowsFromD1();
  console.log(
    JSON.stringify(
      {
        mint_base58: mint,
        decimals,
        fetched_at: new Date().toISOString(),
        row_count: rows.length,
      },
      null,
      2,
    ),
  );

  const results = [];
  for (const row of rows) {
    const email = row.email ?? "";
    const pk = String(row.custodial_pubkey || "").trim();
    if (!pk) continue;
    const live = await readLiveWithFallbacks(mint, pk, decimals);
    results.push({
      email,
      custodial_pubkey: pk,
      sol_lamports_live: live.sol,
      sol_live: live.sol / 1e9,
      rrtt_whole_units_live: live.rrtt,
      sol_rpc_ok: live.solOk,
      token_rpc_ok: live.tokenOk,
      rpc_host_used: live.rpcHost || undefined,
      error: live.error,
    });
    await new Promise((r) => setTimeout(r, 120));
  }

  console.log(JSON.stringify({ balances: results }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
