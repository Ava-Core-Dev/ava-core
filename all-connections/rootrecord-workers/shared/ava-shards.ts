/**
 * Ava Shards — internal vote / tip ledger (SPL mint optional later).
 * Peg: 100 shards = $1 USD always (1 shard = 1 cent).
 * Ava (operator) is minted ceil(player * 42 / 58) so she holds at least 42% of supply.
 */
import { CARD_FEE_BPS } from "./platform-fees";

export const AVA_SHARDS_PER_USD = 100;
export const AVA_VOTE_NUM = 42;
export const AVA_VOTE_DEN = 100;
/** Ava's public Root Record identity (server goals / shard reserve). */
export const SERVER_GOAL_EMAIL = "ava@rootrecord.info";

/** Staff who may operate Ava server tooling while signed in as themselves. */
const AVA_OPERATOR_EMAILS = new Set([
  SERVER_GOAL_EMAIL,
  "root@rootrecord.info",
  "rootrecord@outlook.com",
]);

export function isAvaOperatorEmail(email: string): boolean {
  return AVA_OPERATOR_EMAILS.has(String(email || "").trim().toLowerCase());
}

export type ShardDb = {
  prepare: (q: string) => {
    bind: (...a: unknown[]) => {
      run: () => Promise<unknown>;
      first: <T>() => Promise<T | null>;
      all: <T>() => Promise<{ results?: T[] }>;
    };
  };
};

export function shardsFromUsdCents(cents: number): number {
  return Math.max(0, Math.floor(Number(cents) || 0));
}

export function usdCentsFromShards(shards: number): number {
  return Math.max(0, Math.floor(Number(shards) || 0));
}

/** Extra shards minted to Ava so her share of (player + ava) is at least 42%. */
export function avaReserveForPlayerMint(playerShards: number): number {
  const p = Math.max(0, Math.floor(playerShards));
  if (p <= 0) return 0;
  return Math.ceil((p * AVA_VOTE_NUM) / (AVA_VOTE_DEN - AVA_VOTE_NUM));
}

export async function operatorAccountId(db: ShardDb): Promise<string | null> {
  const row = await db
    .prepare("SELECT id FROM license_accounts WHERE email = ? LIMIT 1")
    .bind(SERVER_GOAL_EMAIL)
    .first<{ id: string }>();
  return String(row?.id || "").trim() || null;
}

/** Ava's Root Record account is a permanent lifetime member (operator grant). */
export async function ensureAvaLifetimeMember(db: ShardDb): Promise<void> {
  const email = SERVER_GOAL_EMAIL;
  const now = new Date().toISOString();
  try {
    const existing = await db
      .prepare("SELECT id FROM user_accounts WHERE email = ?")
      .bind(email)
      .first<{ id: string }>();
    if (existing?.id) {
      await db
        .prepare(
          "UPDATE user_accounts SET life_member = 1, pro_unlocked = 1, updated_at = ? WHERE email = ?",
        )
        .bind(now, email)
        .run();
      return;
    }
    const lic = await operatorAccountId(db);
    await db
      .prepare(
        `INSERT INTO user_accounts (id, email, account_id, created_at, updated_at, pro_unlocked, life_member, extra_json)
         VALUES (?, ?, ?, ?, ?, 1, 1, ?)
         ON CONFLICT(email) DO UPDATE SET
           life_member = 1,
           pro_unlocked = 1,
           updated_at = excluded.updated_at,
           extra_json = COALESCE(user_accounts.extra_json, excluded.extra_json)`,
      )
      .bind(
        crypto.randomUUID(),
        email,
        lic,
        now,
        now,
        JSON.stringify({ granted: "ava_operator_lifetime" }),
      )
      .run();
  } catch {
    /* ignore — D1 schema missing in some local shards */
  }
}

async function creditOne(
  db: ShardDb,
  accountId: string,
  delta: number,
  kind: string,
  ref: string,
  memo: string | null,
  now: string,
): Promise<boolean> {
  const aid = String(accountId || "").trim();
  const n = Math.floor(Number(delta) || 0);
  const r = String(ref || "").trim();
  if (!aid || !r || n === 0) return false;
  const ins = await db
    .prepare(
      `INSERT OR IGNORE INTO rg_ava_shard_ledger (id, account_id, delta, kind, ref, memo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), aid, n, kind, r, memo, now)
    .run();
  const changed = Number((ins as { meta?: { changes?: number } })?.meta?.changes || 0);
  if (changed <= 0) return false;
  await db
    .prepare(
      `INSERT INTO rg_ava_shard_balances (account_id, shards, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET shards = shards + excluded.shards, updated_at = excluded.updated_at`,
    )
    .bind(aid, n, now)
    .run();
  return true;
}

export async function creditPlayerShards(
  db: ShardDb,
  params: {
    accountId: string;
    shards: number;
    txRef: string;
    kind: string;
    memo: string;
    minShards?: number;
  },
): Promise<{ ok: true; player: number; ava: number } | { ok: false; reason: string }> {
  const accountId = String(params.accountId || "").trim();
  const txRef = String(params.txRef || "").trim();
  const player = Math.max(0, Math.floor(Number(params.shards) || 0));
  const min = Math.max(1, Math.floor(Number(params.minShards) || 1));
  if (!accountId || !txRef) return { ok: false, reason: "missing_account" };
  if (player < min) return { ok: false, reason: "min_shards" };
  const ava = avaReserveForPlayerMint(player);
  const now = new Date().toISOString();
  try {
    const did = await creditOne(db, accountId, player, params.kind, `shards:${txRef}`, params.memo, now);
    if (!did) return { ok: true, player, ava: 0 };
    const op = await operatorAccountId(db);
    if (op && ava > 0) {
      await creditOne(db, op, ava, "ava_reserve", `ava:${txRef}`, "Ava 42% vote reserve", now);
    }
    return { ok: true, player, ava };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("ava_shards_credit", msg.slice(0, 200));
    return { ok: false, reason: msg.slice(0, 120) };
  }
}

export async function creditStripeShardPurchase(
  db: ShardDb,
  params: { accountId: string; usdCents: number; txRef: string },
): Promise<{ ok: true; player: number; ava: number } | { ok: false; reason: string }> {
  return creditPlayerShards(db, {
    accountId: params.accountId,
    shards: shardsFromUsdCents(params.usdCents),
    txRef: params.txRef,
    kind: "stripe_buy",
    memo: "Stripe Ava Shards",
    minShards: AVA_SHARDS_PER_USD,
  });
}

export async function transferShards(
  db: ShardDb,
  fromAccountId: string,
  toAccountId: string,
  shards: number,
  kind: string,
  ref: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const from = String(fromAccountId || "").trim();
  const to = String(toAccountId || "").trim();
  const n = Math.floor(Number(shards) || 0);
  if (!from || !to || from === to) return { ok: false, reason: "invalid_accounts" };
  if (n < 1) return { ok: false, reason: "amount" };
  const now = new Date().toISOString();
  const row = await db
    .prepare("SELECT shards FROM rg_ava_shard_balances WHERE account_id = ?")
    .bind(from)
    .first<{ shards: number }>();
  const have = Math.floor(Number(row?.shards) || 0);
  if (have < n) return { ok: false, reason: "insufficient" };
  const debit = await creditOne(db, from, -n, `${kind}_out`, `${ref}:out`, null, now);
  if (!debit) return { ok: false, reason: "duplicate" };
  await creditOne(db, to, n, `${kind}_in`, `${ref}:in`, null, now);
  return { ok: true };
}

export async function shardBalance(db: ShardDb, accountId: string): Promise<number> {
  const row = await db
    .prepare("SELECT shards FROM rg_ava_shard_balances WHERE account_id = ?")
    .bind(accountId)
    .first<{ shards: number }>();
  return Math.max(0, Math.floor(Number(row?.shards) || 0));
}

export async function governanceSnapshot(db: ShardDb): Promise<{
  player_shards: number;
  ava_shards: number;
  total_shards: number;
  ava_vote_pct: number;
  player_vote_pct: number;
  peg_shards_per_usd: number;
  usd_value_if_minted: number;
  mint_base58: string | null;
  card_fee_bps: number;
}> {
  const op = await operatorAccountId(db);
  const avaRow = op
    ? await db
        .prepare("SELECT shards FROM rg_ava_shard_balances WHERE account_id = ?")
        .bind(op)
        .first<{ shards: number }>()
    : null;
  const ava = Math.max(0, Math.floor(Number(avaRow?.shards) || 0));
  const sum = await db
    .prepare(
      `SELECT COALESCE(SUM(shards), 0) AS s FROM rg_ava_shard_balances
       WHERE account_id NOT LIKE 'goal:%'`,
    )
    .first<{ s: number }>();
  const total = Math.max(0, Math.floor(Number(sum?.s) || 0));
  const player = Math.max(0, total - ava);
  const avaPct = total > 0 ? (ava / total) * 100 : AVA_VOTE_NUM;
  const meta = await db
    .prepare("SELECT mint_base58 FROM rg_ava_shard_meta WHERE id = 1")
    .first<{ mint_base58: string | null }>()
    .catch(() => null);
  const mint = String(meta?.mint_base58 || "").trim() || null;
  return {
    player_shards: player,
    ava_shards: ava,
    total_shards: total,
    ava_vote_pct: Math.round(avaPct * 100) / 100,
    player_vote_pct: Math.round((100 - avaPct) * 100) / 100,
    peg_shards_per_usd: AVA_SHARDS_PER_USD,
    usd_value_if_minted: total / AVA_SHARDS_PER_USD,
    mint_base58: mint,
    card_fee_bps: CARD_FEE_BPS,
  };
}
