/**
 * Freeze every currently UNFROZEN holder of an SPL mint (full chain rescan each pass/tick —
 * same rules apply to long-lived wallets and brand-new sniper ATAs). Except:
 *   - the single token account with the highest balance for this mint (always)
 *   - any token account whose OWNER is the on-chain mint authority or freeze authority (from mint)
 *   - any owner pubkey in DEFAULT_EXCLUDE_OWNERS (always) plus --exclude pk1,pk2,...
 *   - any token account pubkey in DEFAULT_EXCLUDE_TOKEN_ACCOUNTS (Raydium pool vault) plus
 *     --exclude-accounts OR env RRTT_FREEZE_EXCLUDE_TOKEN_ACCOUNTS
 *
 * Loads RRTT_FREEZE_AUTHORITY_SECRET_B58, RRTT_MINT_BASE58, and RPC from repo-root
 * credentials.env (parent walk; same as sweep-custodial-sol.ps1).
 *
 * RPC order (first healthy wins): SOLANA_RPC_URL → HELIUS_RPC_URL (full URL) →
 * URL built from HELIUS_API_KEY (or NEXT_PUBLIC_HELIUS_API_KEY / SOLANA_HELIUS_API_KEY) →
 * NEXT_PUBLIC_RPC_URL → public fallbacks.
 * Auto-detects classic SPL Token vs Token-2022 from the mint owner.
 *
 * Runs entirely in local Node against Solana JSON-RPC only — no Cloudflare Workers,
 * no RootRecord HTTP API, no Wrangler.
 *
 * Usage (from rootrecord-primary):
 *   node scripts/freeze-new-token-accounts.mjs                      # single dry-run
 *   node scripts/freeze-new-token-accounts.mjs --watch              # rescan every 1s default (dry-run)
 *   node scripts/freeze-new-token-accounts.mjs --watch --live       # rescan + freeze every 1s default
 *   node scripts/freeze-new-token-accounts.mjs --watch --interval-ms 10000 --live # slower tick
 *   node scripts/freeze-new-token-accounts.mjs --watch --live --dry # scan only (overrides --live)
 *   node scripts/freeze-new-token-accounts.mjs --watch --once       # single pass (overrides --watch)
 *   node scripts/freeze-new-token-accounts.mjs --live               # single pass live
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  AccountLayout,
  AccountState,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createFreezeAccountInstruction,
  unpackAccount,
  unpackMint,
} from "@solana/spl-token";
import bs58 from "bs58";

// ---- constants ---------------------------------------------------------------

const DEFAULT_MINT_B58 = "8hwxLN1Q4Yr8xFErErULCqNvcF1cMwGjpRXPz6DAH7gM";
const DEFAULT_EXCLUDE_OWNERS = new Set([
  "G1DHctEcwkiLw8NZDfCbDCbuPktQBmWa6P2aobDuMKuZ",
]);
/** SPL token account addresses for this mint that must never be frozen (e.g. Raydium vault). */
const DEFAULT_EXCLUDE_TOKEN_ACCOUNTS = new Set([
  "B5AZM1c9oPDUUY4bgyaEYNaGHbnPDXGp1qDqQeU1w9KW",
  "GjFZgWjTBi8CW2KHPgMRXpLMkyUF3squZsnRZi4jLVNV",
  "GjUnPAYqf3NQL5dDBDH2TdmgkSe53AdaXwDggxFKFryz",
]);
const RPC_FALLBACKS = [
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
  "https://api.mainnet-beta.solana.com",
];
const FREEZES_PER_TX = 12;
const PRIORITY_FEE_MICROLAMPORTS = 100_000;
const COMPUTE_UNIT_LIMIT = 250_000;
const DEFAULT_WATCH_INTERVAL_MS = 1000;
const MIN_WATCH_INTERVAL_MS = 200;
const MULTI_GET_CHUNK = 100;

// ---- env loader (same parent-walk as sweep-custodial-sol.ps1) ---------------

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
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const credPath = findCredentialsEnv(__dirname);
if (!credPath) {
  throw new Error(`credentials.env not found (walked parents from ${__dirname}).`);
}
loadEnvFile(credPath);

// ---- args --------------------------------------------------------------------

const argv = process.argv.slice(2);
function flagValue(name) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : null;
}
/** `--dry` / `--dry-run` disables sending even if `--live` is present (e.g. launcher passes --live). */
const dry = argv.includes("--dry") || argv.includes("--dry-run");
const live = argv.includes("--live") && !dry;
/** `--once` forces a single pass (e.g. when .bat always passes `--watch`). */
const once = argv.includes("--once");
const watch = argv.includes("--watch") && !once;
const mintArg = flagValue("--mint");
const excludeArg = flagValue("--exclude");
const excludeAccountsArg = flagValue("--exclude-accounts");
const intervalArg = flagValue("--interval-ms");

const cliExclude = (excludeArg || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const cliExcludeAccounts = (excludeAccountsArg || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const envExcludeAccounts = (process.env.RRTT_FREEZE_EXCLUDE_TOKEN_ACCOUNTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let intervalMs = DEFAULT_WATCH_INTERVAL_MS;
if (intervalArg != null) {
  const n = Number.parseInt(intervalArg, 10);
  if (!Number.isFinite(n) || n < MIN_WATCH_INTERVAL_MS) {
    throw new Error(`--interval-ms must be a number >= ${MIN_WATCH_INTERVAL_MS}`);
  }
  intervalMs = n;
}

const mintB58 = mintArg || process.env.RRTT_MINT_BASE58 || DEFAULT_MINT_B58;
const authSecretB58 = (process.env.RRTT_FREEZE_AUTHORITY_SECRET_B58 || "").trim();
if (!authSecretB58) {
  throw new Error("RRTT_FREEZE_AUTHORITY_SECRET_B58 missing from credentials.env.");
}

let mintPk;
try {
  mintPk = new PublicKey(mintB58);
} catch {
  throw new Error(`invalid --mint / RRTT_MINT_BASE58: ${mintB58}`);
}

let authority;
try {
  authority = Keypair.fromSecretKey(bs58.decode(authSecretB58));
} catch (e) {
  throw new Error(`invalid RRTT_FREEZE_AUTHORITY_SECRET_B58 (bs58 decode failed): ${e?.message || e}`);
}

for (const o of cliExclude) {
  try { new PublicKey(o); } catch { throw new Error(`invalid --exclude pubkey: ${o}`); }
}

/** Owner pubkeys whose token accounts for this mint are never frozen (defaults + CLI + mint roles). */
function buildOwnerExcludes(mint) {
  const s = new Set([...DEFAULT_EXCLUDE_OWNERS, ...cliExclude]);
  if (mint.mintAuthority) s.add(mint.mintAuthority.toBase58());
  if (mint.freezeAuthority) s.add(mint.freezeAuthority.toBase58());
  return s;
}

const excludeAccountB58 = new Set([
  ...DEFAULT_EXCLUDE_TOKEN_ACCOUNTS,
  ...envExcludeAccounts,
  ...cliExcludeAccounts,
]);
for (const a of excludeAccountB58) {
  try { new PublicKey(a); } catch { throw new Error(`invalid --exclude-accounts / RRTT_FREEZE_EXCLUDE_TOKEN_ACCOUNTS pubkey: ${a}`); }
}

// ---- rpc selection ----------------------------------------------------------

function heliusMainnetFromApiKey(apiKey) {
  const k = String(apiKey || "").trim();
  if (!k) return null;
  return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(k)}`;
}

/** Deduped list: paid/custom endpoints first, then public fallbacks (same set as custodial sweep). */
function rpcCandidateUrls() {
  const raw = [
    process.env.SOLANA_RPC_URL,
    process.env.HELIUS_RPC_URL,
    heliusMainnetFromApiKey(
      process.env.HELIUS_API_KEY ||
        process.env.NEXT_PUBLIC_HELIUS_API_KEY ||
        process.env.SOLANA_HELIUS_API_KEY
    ),
    process.env.NEXT_PUBLIC_RPC_URL,
    ...RPC_FALLBACKS,
  ];
  const out = [];
  for (const u of raw) {
    const s = String(u || "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

async function pickConnection() {
  const candidates = rpcCandidateUrls();
  for (const url of candidates) {
    try {
      const conn = new Connection(url, "confirmed");
      await conn.getLatestBlockhash("confirmed");
      return { conn, url };
    } catch {
      // try next
    }
  }
  throw new Error("no reachable Solana RPC (tried " + candidates.map(redactRpcUrl).join(", ") + ")");
}

/** Avoid echoing api-key=... into logs / shell history. */
function redactRpcUrl(u) {
  const s = String(u || "");
  if (s.includes("api-key=")) return s.replace(/api-key=[^&]+/i, "api-key=***");
  return s;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmtAmount(amount, decimals) {
  if (decimals <= 0) return amount.toString();
  const s = amount.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** One-time: mint account, program id, unpack mint, freeze authority check. */
async function loadMintContext(conn) {
  const mintInfo = await conn.getAccountInfo(mintPk, "confirmed");
  if (!mintInfo) throw new Error(`mint account not found: ${mintPk.toBase58()}`);
  const ownerProgram = mintInfo.owner;
  const isToken2022 = ownerProgram.equals(TOKEN_2022_PROGRAM_ID);
  const isClassic = ownerProgram.equals(TOKEN_PROGRAM_ID);
  if (!isToken2022 && !isClassic) {
    throw new Error(`mint owner is not an SPL Token program: ${ownerProgram.toBase58()}`);
  }
  const programId = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const mint = unpackMint(mintPk, mintInfo, programId);
  if (!mint.freezeAuthority) {
    throw new Error("mint has no freeze authority (already disabled).");
  }
  if (!mint.freezeAuthority.equals(authority.publicKey)) {
    throw new Error(
      `freeze-authority mismatch. mint expects ${mint.freezeAuthority.toBase58()} but loaded key is ${authority.publicKey.toBase58()}.`
    );
  }
  const filters = [{ memcmp: { offset: 0, bytes: mintPk.toBase58() } }];
  if (!isToken2022) filters.unshift({ dataSize: 165 });
  return { programId, mint, isToken2022, filters };
}

/** Scan chain + compute freeze targets for this tick. */
async function scanTargets(conn, ctx, ownerExcludes) {
  const { programId, mint, filters } = ctx;
  const accounts = await conn.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters,
  });

  const parsed = [];
  let parseErrors = 0;
  for (const { pubkey, account } of accounts) {
    try {
      const buf = account.data.length === 165 ? account.data : account.data.subarray(0, 165);
      const acc = AccountLayout.decode(buf);
      parsed.push({
        address: pubkey,
        owner: new PublicKey(acc.owner),
        amount: acc.amount,
        state: acc.state,
      });
    } catch {
      parseErrors++;
    }
  }

  const initialized = parsed.filter((p) => p.state === AccountState.Initialized);
  const frozen = parsed.filter((p) => p.state === AccountState.Frozen);

  if (initialized.length === 0) {
    return {
      parsedLength: parsed.length,
      parseErrors,
      initialized,
      frozenCount: frozen.length,
      largest: null,
      targets: [],
      nSkippedLargest: 0,
      nSkippedOwner: 0,
      nSkippedAccount: 0,
    };
  }

  let largest = initialized[0];
  for (const p of initialized) {
    if (p.amount > largest.amount) largest = p;
  }

  const targets = initialized.filter(
    (p) =>
      !p.address.equals(largest.address) &&
      !ownerExcludes.has(p.owner.toBase58()) &&
      !excludeAccountB58.has(p.address.toBase58())
  );

  const nSkippedLargest = initialized.filter((p) => p.address.equals(largest.address)).length;
  const nSkippedOwner = initialized.filter(
    (p) => !p.address.equals(largest.address) && ownerExcludes.has(p.owner.toBase58())
  ).length;
  const nSkippedAccount = initialized.filter(
    (p) =>
      !p.address.equals(largest.address) &&
      !ownerExcludes.has(p.owner.toBase58()) &&
      excludeAccountB58.has(p.address.toBase58())
  ).length;

  return {
    parsedLength: parsed.length,
    parseErrors,
    initialized,
    frozenCount: frozen.length,
    largest,
    targets,
    nSkippedLargest,
    nSkippedOwner,
    nSkippedAccount,
  };
}

/**
 * Re-read each target on-chain right before building txs. Drops accounts that are
 * already frozen or gone so one bad row does not fail an entire multi-freeze batch.
 */
async function filterStillUnfrozenForFreeze(conn, programId, targets) {
  if (targets.length === 0) return [];
  const kept = [];
  for (let off = 0; off < targets.length; off += MULTI_GET_CHUNK) {
    const slice = targets.slice(off, off + MULTI_GET_CHUNK);
    const keys = slice.map((t) => t.address);
    const infos = await conn.getMultipleAccountsInfo(keys, "confirmed");
    for (let i = 0; i < slice.length; i++) {
      const t = slice[i];
      const info = infos[i];
      if (!info) continue;
      try {
        const u = unpackAccount(t.address, info, programId);
        if (!u.mint.equals(mintPk)) continue;
        if (!u.isInitialized || u.isFrozen) continue;
        kept.push(t);
      } catch {
        // wrong owner / size / closed — skip
      }
    }
  }
  return kept;
}

async function freezeTargets(conn, ctx, targets) {
  const { programId, mint } = ctx;
  const batches = chunk(targets, FREEZES_PER_TX);
  let okCount = 0;
  let errCount = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      const ixs = [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICROLAMPORTS }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
        ...batch.map((t) =>
          createFreezeAccountInstruction(t.address, mintPk, authority.publicKey, [], programId)
        ),
      ];
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({
        payerKey: authority.publicKey,
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      tx.sign([authority]);
      const sig = await conn.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      okCount += batch.length;
      console.log(`  batch ${i + 1}/${batches.length} ok (${batch.length} freezes) sig=${sig}`);
    } catch (e) {
      errCount += batch.length;
      console.error(`  batch ${i + 1}/${batches.length} FAILED (${batch.length} freezes): ${e?.message || e}`);
    }
  }
  return { okCount, errCount };
}

function logScanVerbose(scan, mintDecimals, ownerExcludes) {
  console.log(
    `holders: total=${scan.parsedLength} initialized=${scan.initialized.length} frozen=${scan.frozenCount} parse_errors=${scan.parseErrors}`
  );
  if (!scan.largest) {
    console.log("nothing to freeze (no initialized holders).");
    return;
  }
  console.log(
    `largest (excluded): account=${scan.largest.address.toBase58()} owner=${scan.largest.owner.toBase58()} amount=${fmtAmount(scan.largest.amount, mintDecimals)}`
  );
  console.log(
    `excluded_owners=${[...ownerExcludes].join(",") || "(none)"} excluded_token_accounts=${[...excludeAccountB58].join(",") || "(none)"}`
  );
  console.log(
    `skip_counts: as_largest=${scan.nSkippedLargest} by_owner_exclude=${scan.nSkippedOwner} by_token_account_exclude=${scan.nSkippedAccount} targets=${scan.targets.length}`
  );
  const top = [...scan.targets]
    .sort((a, b) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0))
    .slice(0, 5);
  if (top.length) {
    console.log("top 5 targets:");
    for (const t of top) {
      console.log(
        `  ${t.address.toBase58()}  owner=${t.owner.toBase58()}  amount=${fmtAmount(t.amount, mintDecimals)}`
      );
    }
  }
}

function logScanCompact(ts, tick, scan, live) {
  const lg = scan.largest ? scan.largest.address.toBase58().slice(0, 8) : "-";
  let line = `[${ts}] tick=${tick} total=${scan.parsedLength} init=${scan.initialized.length} frozen=${scan.frozenCount} targets=${scan.targets.length} largest=${lg}…`;
  if (!live && scan.targets.length > 0) {
    line += " | NO TX (add --live to freeze)";
  }
  console.log(line);
}

async function main() {
  const { conn, url } = await pickConnection();
  console.log(`rpc: ${redactRpcUrl(url)}`);
  if (watch && RPC_FALLBACKS.includes(url)) {
    console.warn(
      "warning: --watch fell through to a public RPC; repeated getProgramAccounts may rate-limit. Set SOLANA_RPC_URL or HELIUS_API_KEY in credentials.env."
    );
  }
  console.log(`mint: ${mintPk.toBase58()}`);
  console.log(`authority: ${authority.publicKey.toBase58()}`);
  console.log(
    `mode: ${live ? "LIVE" : "dry-run"}${dry ? " (--dry: no transactions)" : ""}${watch ? ` watch interval=${intervalMs}ms` : ""}`
  );
  if (dry && argv.includes("--live")) {
    console.log("note: --dry / --dry-run wins over --live; remove --dry to submit txs.");
  }

  const ctx = await loadMintContext(conn);
  console.log(`program: ${ctx.isToken2022 ? "Token-2022" : "Token"}`);
  const ownerExcludes = buildOwnerExcludes(ctx.mint);
  const ma = ctx.mint.mintAuthority ? ctx.mint.mintAuthority.toBase58() : "(revoked)";
  const fa = ctx.mint.freezeAuthority ? ctx.mint.freezeAuthority.toBase58() : "(none)";
  console.log(`excluded by owner: mint_authority=${ma} freeze_authority=${fa} (+ defaults and --exclude)`);

  const runOnePass = async (opts) => {
    const { verbose, tick, ts } = opts;
    if (verbose) console.log("scanning token accounts...");
    const scan = await scanTargets(conn, ctx, ownerExcludes);
    if (verbose) {
      logScanVerbose(scan, ctx.mint.decimals, ownerExcludes);
    } else if (tick != null) {
      logScanCompact(ts, tick, scan, live);
    }

    if (!live) {
      if (verbose) console.log("\ndry-run only. Re-run with --live to submit.");
      return scan;
    }
    if (scan.targets.length === 0) {
      if (verbose) console.log("no targets after filtering; nothing to send.");
      return scan;
    }
    const toFreeze = await filterStillUnfrozenForFreeze(conn, ctx.programId, scan.targets);
    if (toFreeze.length < scan.targets.length) {
      console.log(
        `pre-send refresh: ${scan.targets.length} GPA targets -> ${toFreeze.length} still unfrozen (dropped already-frozen/closed/mint-mismatch)`
      );
    }
    if (toFreeze.length === 0) {
      console.log("pre-send refresh: nothing left to freeze this tick.");
      return scan;
    }
    console.log(
      `submitting freeze for ${toFreeze.length} account(s) (${FREEZES_PER_TX}/tx, priority=${PRIORITY_FEE_MICROLAMPORTS}uLam/CU)...`
    );
    const { okCount, errCount } = await freezeTargets(conn, ctx, toFreeze);
    console.log(`tick done. frozen=${okCount} failed=${errCount} of ${toFreeze.length}`);
    return scan;
  };

  if (!watch) {
    await runOnePass({ verbose: true });
    return;
  }

  if (live) {
    console.log(
      "Each tick re-fetches ALL token accounts for this mint; every unfrozen account is frozen except: (1) single highest-balance account, (2) accounts owned by mint/freeze authority or other excluded owners, (3) --exclude-accounts."
    );
  }

  console.log(`watch: Ctrl+C to stop`);
  if (!live) {
    console.log(
      "watch+dry-run: RPC scans only — zero transactions. Re-run with --watch --live to send FreezeAccount txs."
    );
  }
  let tick = 0;
  const stop = () => {
    console.log("\nwatch stopped.");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (true) {
    tick++;
    const ts = new Date().toISOString();
    try {
      await runOnePass({ verbose: false, tick, ts });
    } catch (e) {
      console.error(`[${ts}] tick=${tick} ERROR:`, e?.message || e);
    }
    await sleep(intervalMs);
  }
}

main().catch((e) => {
  console.error("fatal:", e?.message || e);
  process.exit(1);
});
