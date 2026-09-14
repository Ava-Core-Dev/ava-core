import type { D1Database } from "@cloudflare/workers-types";
import { Connection, PublicKey } from "@solana/web3.js";

import { json } from "./cors";
import { verifyWorkerOpsAdmin } from "./push";

const ROOTS_MINT_DEFAULT = "8hwxLN1Q4Yr8xFErErULCqNvcF1cMwGjpRXPz6DAH7gM";
const ROOTS_BUY_CHANNEL_DEFAULT = "1505853241915736154";
const TREASURY_WALLET = "G1DHctEcwkiLw8NZDfCbDCbuPktQBmWa6P2aobDuMKuZ";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const STATE_KEY = "roots_onchain_buy_latest_signature";

const RPC_FALLBACKS = [
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
  "https://api.mainnet-beta.solana.com",
] as const;

const DEX_PROGRAM_IDS = new Set([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  "675kPX9MHTjS2zt1qfr1NYnPxqVZAGf5K2jBhmh3kf",
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  "routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS",
  "whirLbMiicVdio4qvUfM5KAg6Ct9hqxPXBfWvhmr85",
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB",
]);

export type RootsOnchainBuyMonitorEnv = {
  DB: D1Database;
  RR_PUSH_ADMIN_SECRET?: string;
  SOLANA_RPC_URL?: string;
  ROOTS_MINT_BASE58?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_ROOTS_BUY_CHANNEL_ID?: string;
};

type ParsedTokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount?: { amount?: string; decimals?: number; uiAmountString?: string };
};

type DetectedBuy = {
  signature: string;
  slot: number;
  buyerOwner: string | null;
  buyerTokenAccount: string | null;
  amountRaw: bigint;
  decimals: number;
  spentWsolRaw: bigint;
};

export type RootsOnchainBuyMonitorResult = {
  ok: boolean;
  skipped?: string;
  bootstrapped?: boolean;
  scanned: number;
  candidates: number;
  notified: number;
  errors: string[];
  latest_signature?: string;
  rpc_url_used?: string;
};

function rpcCandidates(envUrl: string): string[] {
  const out: string[] = [];
  const u = String(envUrl || "").trim();
  if (u) out.push(u);
  for (const f of RPC_FALLBACKS) {
    if (!out.includes(f)) out.push(f);
  }
  return out;
}

async function pickConnection(envUrl: string): Promise<{ connection: Connection; rpcUrl: string } | null> {
  for (const url of rpcCandidates(envUrl)) {
    try {
      const connection = new Connection(url, "confirmed");
      await connection.getLatestBlockhash("confirmed");
      return { connection, rpcUrl: url };
    } catch {
      // try next RPC
    }
  }
  return null;
}

function tokenAmountRaw(balance: ParsedTokenBalance | undefined): bigint {
  const amount = String(balance?.uiTokenAmount?.amount || "0");
  return /^\d+$/.test(amount) ? BigInt(amount) : 0n;
}

function formatTokenAmount(raw: bigint, decimals: number): string {
  if (decimals <= 0) return raw.toString();
  const div = 10n ** BigInt(decimals);
  const whole = raw / div;
  const frac = (raw % div).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

function keyString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "pubkey" in raw) {
    const pubkey = (raw as { pubkey?: unknown }).pubkey;
    if (typeof pubkey === "string") return pubkey;
    if (pubkey && typeof pubkey === "object" && "toBase58" in pubkey) {
      return String((pubkey as { toBase58: () => string }).toBase58());
    }
  }
  return String(raw || "");
}

function collectProgramIds(tx: unknown): Set<string> {
  const out = new Set<string>();
  if (!tx || typeof tx !== "object") return out;
  const message = (tx as { transaction?: { message?: { accountKeys?: unknown[]; instructions?: unknown[] } } }).transaction?.message;
  for (const key of message?.accountKeys || []) {
    const s = keyString(key);
    if (s) out.add(s);
  }
  const walk = (ixs: unknown[] | undefined) => {
    for (const ix of ixs || []) {
      const obj = ix as { programId?: unknown; innerInstructions?: unknown[] };
      const pid = keyString(obj.programId);
      if (pid) out.add(pid);
      walk(obj.innerInstructions);
    }
  };
  walk(message?.instructions);
  return out;
}

function accountKeyAt(tx: unknown, index: number): string | null {
  if (!tx || typeof tx !== "object") return null;
  const keys = (tx as { transaction?: { message?: { accountKeys?: unknown[] } } }).transaction?.message?.accountKeys || [];
  const s = keyString(keys[index]);
  return s || null;
}

function detectRootsBuy(tx: unknown, signature: string, mint: string): DetectedBuy | null {
  if (!tx || typeof tx !== "object") return null;
  const meta = (tx as { meta?: { preTokenBalances?: ParsedTokenBalance[]; postTokenBalances?: ParsedTokenBalance[] } }).meta;
  const slot = Math.floor(Number((tx as { slot?: number }).slot) || 0);
  if (!meta) return null;

  const programs = collectProgramIds(tx);
  const hasDexProgram = Array.from(programs).some((id) => DEX_PROGRAM_IDS.has(id));
  if (!hasDexProgram) return null;

  const pre = new Map<number, ParsedTokenBalance>();
  for (const b of meta.preTokenBalances || []) pre.set(b.accountIndex, b);

  let buyerOwner: string | null = null;
  let buyerTokenAccount: string | null = null;
  let amountRaw = 0n;
  let decimals = 8;
  for (const post of meta.postTokenBalances || []) {
    if (post.mint !== mint) continue;
    const before = tokenAmountRaw(pre.get(post.accountIndex));
    const after = tokenAmountRaw(post);
    const delta = after - before;
    if (delta <= 0n) continue;
    const owner = String(post.owner || "").trim() || null;
    if (owner === TREASURY_WALLET) continue;
    amountRaw += delta;
    decimals = Math.max(0, Math.floor(Number(post.uiTokenAmount?.decimals) || decimals));
    buyerOwner = buyerOwner || owner;
    buyerTokenAccount = buyerTokenAccount || accountKeyAt(tx, post.accountIndex);
  }
  if (amountRaw <= 0n) return null;

  let spentWsolRaw = 0n;
  for (const post of meta.postTokenBalances || []) {
    if (post.mint !== WSOL_MINT) continue;
    if (buyerOwner && post.owner && post.owner !== buyerOwner) continue;
    const before = tokenAmountRaw(pre.get(post.accountIndex));
    const after = tokenAmountRaw(post);
    const delta = after - before;
    if (delta < 0n) spentWsolRaw += -delta;
  }

  return { signature, slot, buyerOwner, buyerTokenAccount, amountRaw, decimals, spentWsolRaw };
}

async function postDiscordBuy(env: RootsOnchainBuyMonitorEnv, buy: DetectedBuy, mint: string, channelId: string): Promise<void> {
  const token = String(env.DISCORD_BOT_TOKEN || "").trim();
  if (!token) throw new Error("DISCORD_BOT_TOKEN is not configured");
  const rootsAmount = formatTokenAmount(buy.amountRaw, buy.decimals);
  const solSpent = buy.spentWsolRaw > 0n ? formatTokenAmount(buy.spentWsolRaw, 9) : "";
  const lines = [
    "**BUY** ROOTS on-chain",
    `Amount: **${rootsAmount} ROOTS**`,
    solSpent ? `Spent: about **${solSpent} SOL/WSOL**` : "",
    buy.buyerOwner ? `Buyer: \`${buy.buyerOwner}\`` : buy.buyerTokenAccount ? `Token account: \`${buy.buyerTokenAccount}\`` : "",
    `Mint: \`${mint}\``,
    `[View transaction](https://solscan.io/tx/${buy.signature})`,
  ].filter(Boolean);
  const res = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: lines.join("\n").slice(0, 1900),
      allowed_mentions: { parse: [] },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord channel post failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

async function notificationExists(db: D1Database, signature: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM roots_onchain_buy_notifications WHERE signature = ? LIMIT 1")
    .bind(signature)
    .first<{ ok: number }>()
    .catch(() => null);
  return row?.ok === 1;
}

async function recordNotification(
  env: RootsOnchainBuyMonitorEnv,
  buy: DetectedBuy,
  mint: string,
  channelId: string,
): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO roots_onchain_buy_notifications
       (signature, slot, mint, buyer_owner, buyer_token_account, amount_raw, amount_ui, notified_channel_id, notified_at, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      buy.signature,
      buy.slot,
      mint,
      buy.buyerOwner,
      buy.buyerTokenAccount,
      buy.amountRaw.toString(),
      formatTokenAmount(buy.amountRaw, buy.decimals),
      channelId,
      new Date().toISOString(),
      JSON.stringify({ spent_wsol_raw: buy.spentWsolRaw.toString() }),
    )
    .run();
}

async function readState(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM roots_onchain_scan_state WHERE key = ? LIMIT 1")
    .bind(STATE_KEY)
    .first<{ value: string }>()
    .catch(() => null);
  return row?.value ? String(row.value) : null;
}

async function writeState(db: D1Database, signature: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO roots_onchain_scan_state (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(STATE_KEY, signature, new Date().toISOString())
    .run();
}

export async function runRootsOnchainBuyMonitor(
  env: RootsOnchainBuyMonitorEnv,
  opts: { limit?: number } = {},
): Promise<RootsOnchainBuyMonitorResult> {
  const mint = String(env.ROOTS_MINT_BASE58 || ROOTS_MINT_DEFAULT).trim();
  const channelId = String(env.DISCORD_ROOTS_BUY_CHANNEL_ID || ROOTS_BUY_CHANNEL_DEFAULT).trim();
  if (!channelId) return { ok: true, skipped: "no Discord buy channel configured", scanned: 0, candidates: 0, notified: 0, errors: [] };

  const picked = await pickConnection(String(env.SOLANA_RPC_URL || "").trim());
  if (!picked) return { ok: false, skipped: "no working Solana RPC", scanned: 0, candidates: 0, notified: 0, errors: [] };

  const mintPk = new PublicKey(mint);
  const limit = Math.max(5, Math.min(100, Math.floor(Number(opts.limit) || 60)));
  const sigs = await picked.connection.getSignaturesForAddress(mintPk, { limit }, "confirmed");
  const latest = sigs[0]?.signature;
  if (!latest) return { ok: true, scanned: 0, candidates: 0, notified: 0, errors: [], rpc_url_used: picked.rpcUrl };

  const previous = await readState(env.DB);
  if (!previous) {
    await writeState(env.DB, latest);
    return {
      ok: true,
      bootstrapped: true,
      scanned: sigs.length,
      candidates: 0,
      notified: 0,
      errors: [],
      latest_signature: latest,
      rpc_url_used: picked.rpcUrl,
    };
  }

  const newSigs = [];
  for (const s of sigs) {
    if (s.signature === previous) break;
    if (!s.err) newSigs.push(s.signature);
  }

  let candidates = 0;
  let notified = 0;
  const errors: string[] = [];
  for (const signature of newSigs.reverse()) {
    try {
      if (await notificationExists(env.DB, signature)) continue;
      const tx = await picked.connection.getParsedTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      const buy = detectRootsBuy(tx, signature, mint);
      if (!buy) continue;
      candidates += 1;
      await postDiscordBuy(env, buy, mint, channelId);
      await recordNotification(env, buy, mint, channelId);
      notified += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${signature}: ${msg.slice(0, 220)}`);
    }
  }

  if (errors.length === 0) {
    await writeState(env.DB, latest);
  }

  return {
    ok: errors.length === 0,
    scanned: sigs.length,
    candidates,
    notified,
    errors,
    latest_signature: latest,
    rpc_url_used: picked.rpcUrl,
  };
}

export async function handleRootsOnchainBuyMonitorRoute(
  request: Request,
  env: RootsOnchainBuyMonitorEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (method !== "POST" || sub !== "/internal/run-roots-onchain-buy-monitor") return null;
  if (!(await verifyWorkerOpsAdmin(request, env))) {
    return json({ ok: false, detail: "Unauthorized" }, 401);
  }
  const result = await runRootsOnchainBuyMonitor(env);
  return json(result, result.ok ? 200 : 503);
}
