import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { sessionFromRequest, type AuthEnv } from "./primary-auth";

export type RootsTransactionsEnv = AuthEnv & { DB: D1Database };

const TRANSACTIONS_VISIBLE_AFTER_ISO = "2026-05-24T10:00:00.000Z"; // 2026-05-24 00:00 HST
const TRANSACTIONS_VISIBLE_AFTER_LABEL = "05/24 00:00 HST";
const ROOTS_ATOMIC_PER_WHOLE = 100_000_000;

type TxRow = {
  id: string;
  source: "swap" | "deposit" | "ledger" | "market" | "onchain";
  kind: string;
  direction: "in" | "out";
  status: string;
  roots_atomic: number;
  sol_lamports: number;
  tx_signature: string | null;
  title: string;
  detail: string;
  created_at: string;
  meta?: Record<string, unknown>;
};

function safeInt(raw: unknown): number {
  return Math.max(0, Math.floor(Number(raw) || 0));
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "unknown";
  const hst = new Date(d.getTime() - 10 * 60 * 60 * 1000);
  return hst.toISOString().slice(0, 10);
}

function isVisibleTransaction(iso: string): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= Date.parse(TRANSACTIONS_VISIBLE_AFTER_ISO);
}

function marketTitle(game: string): string {
  const clean = String(game || "market").replace(/_/g, " ").trim();
  return `The Well ${clean || "market"} result`;
}

function formatRootsAtomic(atomic: number): string {
  const n = safeInt(atomic);
  const whole = Math.floor(n / ROOTS_ATOMIC_PER_WHOLE);
  const frac = String(n % ROOTS_ATOMIC_PER_WHOLE).padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

export async function handleRootsTransactionsV1(
  request: Request,
  env: RootsTransactionsEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (sub !== "/v1/me/roots/transactions") return null;
  if (method !== "GET") return json({ ok: false, detail: "Method not allowed." }, 405);
  const sess = await sessionFromRequest(env, request);
  if (!sess) return json({ ok: false, detail: "Sign in required." }, 401);

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get("limit")) || 80)));
  const userId = `user:${sess.email.trim().toLowerCase()}`;

  const swaps = await env.DB
    .prepare(
      `SELECT id, input_lamports, quoted_roots_atomic, slippage_bps, status, swap_signature, created_at, updated_at, error
       FROM rr_roots_sol_swaps
       WHERE account_id = ?
         AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(sess.accountId, TRANSACTIONS_VISIBLE_AFTER_ISO, limit)
    .all<{
      id: string;
      input_lamports: string;
      quoted_roots_atomic: number;
      slippage_bps: number;
      status: string;
      swap_signature: string | null;
      created_at: string;
      updated_at: string;
      error: string | null;
    }>()
    .catch(() => ({ results: [] as never[] }));

  const deposits = await env.DB
    .prepare(
      `SELECT id, amount_atomic, status, sweep_signature, close_signature, topup_signature, created_at, updated_at, error
       FROM rr_roots_custodial_deposits
       WHERE account_id = ?
         AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(sess.accountId, TRANSACTIONS_VISIBLE_AFTER_ISO, limit)
    .all<{
      id: string;
      amount_atomic: number;
      status: string;
      sweep_signature: string | null;
      close_signature: string | null;
      topup_signature: string | null;
      created_at: string;
      updated_at: string;
      error: string | null;
    }>()
    .catch(() => ({ results: [] as never[] }));

  const ledger = await env.DB
    .prepare(
      `SELECT id, kind, direction, units, tx_signature, recipient_pubkey, app_snapshot_json, notes, created_at
       FROM rr_earn_custodial_ledger
       WHERE account_id = ?
         AND kind NOT IN ('sol_to_internal_roots_fixed_rate', 'sol_to_internal_roots_direct', 'roots_deposit_to_internal')
         AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(sess.accountId, TRANSACTIONS_VISIBLE_AFTER_ISO, limit)
    .all<{
      id: string;
      kind: string;
      direction: "in" | "out";
      units: number;
      tx_signature: string | null;
      recipient_pubkey: string | null;
      app_snapshot_json: string;
      notes: string | null;
      created_at: string;
    }>()
    .catch(() => ({ results: [] as never[] }));

  const market = await env.DB
    .prepare(
      `SELECT id, game, stake, payout, net, abs_units, created_at
       FROM rr_farms_market_activity
       WHERE user_id = ?
         AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(userId, TRANSACTIONS_VISIBLE_AFTER_ISO, limit)
    .all<{
      id: string;
      game: string;
      stake: number;
      payout: number;
      net: number;
      abs_units: number;
      created_at: string;
    }>()
    .catch(() => ({ results: [] as never[] }));

  const rows: TxRow[] = [];
  for (const r of swaps.results || []) {
    const status = String(r.status || "");
    rows.push({
      id: r.id,
      source: "swap",
      kind: "SOL to internal ROOTS",
      direction: "in",
      status,
      roots_atomic: safeInt(r.quoted_roots_atomic),
      sol_lamports: safeInt(r.input_lamports),
      tx_signature: r.swap_signature,
      title: "Internal ROOTS swap",
      detail: status.includes("credited") ? "SOL moved to treasury and internal ROOTS credited." : r.error || "Swap is pending or failed.",
      created_at: r.created_at,
      meta: { slippage_bps: r.slippage_bps, updated_at: r.updated_at },
    });
  }
  for (const r of deposits.results || []) {
    const sweepSig = r.sweep_signature || r.close_signature || r.topup_signature;
    const hasTopup = Boolean(r.topup_signature);
    rows.push({
      id: r.id,
      source: "deposit",
      kind: "ROOTS deposit",
      direction: "in",
      status: String(r.status || ""),
      roots_atomic: safeInt(r.amount_atomic),
      sol_lamports: 0,
      tx_signature: sweepSig,
      title: "On-chain ROOTS deposit",
      detail:
        r.status === "credited"
          ? hasTopup
            ? "ROOTS swept to treasury, ATA closed to treasury, and treasury SOL top-up was refunded."
            : "ROOTS swept to treasury and credited internally."
          : r.error || "Deposit is pending.",
      created_at: r.created_at,
      meta: { close_signature: r.close_signature, topup_signature: r.topup_signature, updated_at: r.updated_at },
    });
    if (r.close_signature && r.close_signature !== sweepSig) {
      rows.push({
        id: `${r.id}:close`,
        source: "onchain",
        kind: "Close custodial ROOTS ATA",
        direction: "in",
        status: String(r.status || "recorded"),
        roots_atomic: 0,
        sol_lamports: 0,
        tx_signature: r.close_signature,
        title: "Custodial ROOTS ATA closed",
        detail: "Token-account rent was returned to the treasury wallet.",
        created_at: r.updated_at || r.created_at,
        meta: { deposit_id: r.id },
      });
    }
    if (r.topup_signature && r.topup_signature !== sweepSig && r.topup_signature !== r.close_signature) {
      rows.push({
        id: `${r.id}:topup`,
        source: "onchain",
        kind: "Treasury SOL top-up",
        direction: "in",
        status: String(r.status || "recorded"),
        roots_atomic: 0,
        sol_lamports: 0,
        tx_signature: r.topup_signature,
        title: "Treasury-funded custodial action",
        detail: "Treasury supplied the SOL needed for the sweep path; user deposited SOL was not used.",
        created_at: r.updated_at || r.created_at,
        meta: { deposit_id: r.id },
      });
    }
  }
  for (const r of ledger.results || []) {
    rows.push({
      id: r.id,
      source: "ledger",
      kind: String(r.kind || "ledger"),
      direction: r.direction === "out" ? "out" : "in",
      status: "recorded",
      roots_atomic: safeInt(r.units),
      sol_lamports: 0,
      tx_signature: r.tx_signature,
      title: String(r.kind || "Ledger transaction").replace(/_/g, " "),
      detail: String(r.notes || ""),
      created_at: r.created_at,
      meta: { recipient_pubkey: r.recipient_pubkey, app_snapshot: parseJsonObject(r.app_snapshot_json) },
    });
  }
  for (const r of market.results || []) {
    const net = Math.floor(Number(r.net) || 0);
    const stake = safeInt(r.stake);
    const payout = safeInt(r.payout);
    rows.push({
      id: r.id,
      source: "market",
      kind: String(r.game || "market"),
      direction: net < 0 ? "out" : "in",
      status: "recorded",
      roots_atomic: safeInt(r.abs_units),
      sol_lamports: 0,
      tx_signature: null,
      title: marketTitle(String(r.game || "")),
      detail: `Stake ${formatRootsAtomic(stake)} ROOTS, payout ${formatRootsAtomic(payout)} ROOTS. Treasury records the stake side of this market action.`,
      created_at: r.created_at,
      meta: { stake, payout, net },
    });
  }

  rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const transactions = rows.filter((r) => isVisibleTransaction(r.created_at)).slice(0, limit);
  const totals = transactions.reduce(
    (acc, r) => {
      if (r.source === "swap") acc.swap_count += 1;
      if (r.source === "deposit") acc.deposit_count += 1;
      if (r.source === "market") acc.market_count += 1;
      if (r.source === "onchain") acc.onchain_count += 1;
      if (r.direction === "in") acc.roots_in_atomic += r.roots_atomic;
      if (r.direction === "out") acc.roots_out_atomic += r.roots_atomic;
      acc.sol_in_lamports += r.sol_lamports;
      return acc;
    },
    { roots_in_atomic: 0, roots_out_atomic: 0, sol_in_lamports: 0, swap_count: 0, deposit_count: 0, market_count: 0, onchain_count: 0 },
  );
  const byDayMap = new Map<string, { day: string; roots_in_atomic: number; roots_out_atomic: number; sol_lamports: number; count: number }>();
  for (const r of transactions) {
    const k = dayKey(r.created_at);
    const cur = byDayMap.get(k) || { day: k, roots_in_atomic: 0, roots_out_atomic: 0, sol_lamports: 0, count: 0 };
    if (r.direction === "in") cur.roots_in_atomic += r.roots_atomic;
    if (r.direction === "out") cur.roots_out_atomic += r.roots_atomic;
    cur.sol_lamports += r.sol_lamports;
    cur.count += 1;
    byDayMap.set(k, cur);
  }

  return json({
    ok: true,
    transactions,
    totals,
    by_day: Array.from(byDayMap.values()).sort((a, b) => a.day.localeCompare(b.day)),
    explorer_tx_base: "https://solscan.io/tx/",
    visible_after_iso: TRANSACTIONS_VISIBLE_AFTER_ISO,
    visible_after_label: TRANSACTIONS_VISIBLE_AFTER_LABEL,
  });
}
