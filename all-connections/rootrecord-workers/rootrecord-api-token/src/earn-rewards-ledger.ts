import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { extractAuthToken, sessionFromRequest, type AuthEnv } from "./primary-auth";

export type LedgerAppRow = { app_id: string; total_units: number };
export type LedgerAttributed = { app_id: string; units: number };

export type LedgerSnapshot = {
  per_app_totals_at_transfer: LedgerAppRow[];
  attributed_to_this_transfer: LedgerAttributed[];
};

function allocateByTotals(pending: number, apps: LedgerAppRow[]): LedgerAttributed[] {
  const cleaned = apps.map((a) => ({
    app_id: String(a.app_id || "").trim(),
    total_units: Math.max(0, Math.floor(Number(a.total_units) || 0)),
  }));
  const sum = cleaned.reduce((s, a) => s + a.total_units, 0);
  if (pending <= 0 || sum <= 0) return [];
  const out: LedgerAttributed[] = cleaned.map((a) => ({
    app_id: a.app_id,
    units: Math.floor((pending * a.total_units) / sum),
  }));
  let used = out.reduce((s, x) => s + x.units, 0);
  let rem = pending - used;
  let i = 0;
  while (rem > 0 && out.length > 0) {
    out[i % out.length]!.units += 1;
    rem -= 1;
    i += 1;
  }
  return out.filter((x) => x.app_id);
}

async function loadAppTotals(db: D1Database, userId: string): Promise<LedgerAppRow[]> {
  const r = await db
    .prepare("SELECT app_id, total_units FROM rr_earn_app_total WHERE user_id = ? ORDER BY app_id")
    .bind(userId)
    .all<{ app_id: string; total_units: number }>();
  return (r.results || []).map((row) => ({
    app_id: String(row.app_id || ""),
    total_units: Math.max(0, Math.floor(Number(row.total_units) || 0)),
  }));
}

/** After a successful treasury → custodial SPL transfer. */
export async function insertTreasuryToCustodialLedger(
  db: D1Database,
  input: {
    accountId: string;
    emailLower: string;
    units: number;
    txSignature: string;
    earnBalanceSnapshot: number;
    /** Custodial SPL wallet that received RRTT (public audit + ecosystem history). */
    custodialWalletPubkeyB58?: string | null;
  },
): Promise<void> {
  const userId = `user:${input.emailLower}`;
  const perApp = await loadAppTotals(db, userId);
  const attributed = allocateByTotals(input.units, perApp);
  const snapshot: LedgerSnapshot = {
    per_app_totals_at_transfer: perApp,
    attributed_to_this_transfer: attributed,
  };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const recv = String(input.custodialWalletPubkeyB58 || "").trim() || null;
  await db
    .prepare(
      `INSERT INTO rr_earn_custodial_ledger (
         id, account_id, kind, direction, units, tx_signature, recipient_pubkey, app_snapshot_json, earn_balance_snapshot, notes, created_at
       ) VALUES (?, ?, 'treasury_to_custodial', 'in', ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .bind(
      id,
      input.accountId,
      input.units,
      input.txSignature,
      recv,
      JSON.stringify(snapshot),
      input.earnBalanceSnapshot,
      now,
    )
    .run();
}

/** When custodial sends RRTT to a personal wallet (record after confirmed on-chain). */
export async function insertWithdrawalToPersonalLedger(
  db: D1Database,
  input: {
    accountId: string;
    units: number;
    txSignature: string;
    recipientPubkey: string;
    /** Optional copy of app totals at time of withdraw for reporting. */
    appSnapshot?: LedgerSnapshot | null;
    notes?: string | null;
  },
): Promise<void> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const snap = input.appSnapshot ?? { per_app_totals_at_transfer: [], attributed_to_this_transfer: [] };
  await db
    .prepare(
      `INSERT INTO rr_earn_custodial_ledger (
         id, account_id, kind, direction, units, tx_signature, recipient_pubkey, app_snapshot_json, earn_balance_snapshot, notes, created_at
       ) VALUES (?, ?, 'withdrawal_to_personal', 'out', ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .bind(
      id,
      input.accountId,
      input.units,
      input.txSignature,
      input.recipientPubkey,
      JSON.stringify(snap),
      input.notes ?? null,
      now,
    )
    .run();
}

export type RewardsLedgerEnv = AuthEnv & { DB: D1Database };

/** GET `/v1/me/rewards-ledger?limit=&offset=` — Bearer; paginated redemption / transfer history. */
export async function handleRewardsLedgerV1(request: Request, env: RewardsLedgerEnv, method: string): Promise<Response> {
  if (method !== "GET") return json({ detail: "Method not allowed" }, 405);
  const sess = await sessionFromRequest(env, request);
  if (!sess) {
    return json({ detail: extractAuthToken(request) ? "Unauthorized" : "Missing token" }, 401);
  }

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get("limit")) || 50)));
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset")) || 0));

  try {
    const countRow = await env.DB
      .prepare("SELECT COUNT(*) AS c FROM rr_earn_custodial_ledger WHERE account_id = ?")
      .bind(sess.accountId)
      .first<{ c: number }>();
    const total = Math.max(0, Math.floor(Number(countRow?.c) || 0));

    const rows = await env.DB
      .prepare(
        `SELECT id, kind, direction, units, tx_signature, recipient_pubkey, app_snapshot_json, earn_balance_snapshot, notes, created_at
         FROM rr_earn_custodial_ledger WHERE account_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(sess.accountId, limit, offset)
      .all<{
        id: string;
        kind: string;
        direction: string;
        units: number;
        tx_signature: string | null;
        recipient_pubkey: string | null;
        app_snapshot_json: string;
        earn_balance_snapshot: number | null;
        notes: string | null;
        created_at: string;
      }>();

    const transactions = (rows.results || []).map((r) => {
      let app_snapshot: LedgerSnapshot = { per_app_totals_at_transfer: [], attributed_to_this_transfer: [] };
      try {
        app_snapshot = JSON.parse(String(r.app_snapshot_json || "{}")) as LedgerSnapshot;
      } catch {
        /* ignore */
      }
      return {
        id: r.id,
        kind: r.kind,
        direction: r.direction,
        units: Math.max(0, Math.floor(Number(r.units) || 0)),
        tx_signature: r.tx_signature,
        recipient_pubkey: r.recipient_pubkey,
        app_snapshot,
        earn_balance_snapshot: r.earn_balance_snapshot != null ? Math.floor(Number(r.earn_balance_snapshot) || 0) : null,
        notes: r.notes,
        created_at: r.created_at,
      };
    });

    return json(
      {
        ok: true,
        total,
        limit,
        offset,
        solana_cluster: "mainnet-beta",
        explorer_tx_base: "https://solscan.io/tx/",
        transactions,
      },
      200,
    );
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("rewards-ledger", msg);
    return json({ detail: "Could not load rewards ledger.", ok: false }, 500);
  }
}
