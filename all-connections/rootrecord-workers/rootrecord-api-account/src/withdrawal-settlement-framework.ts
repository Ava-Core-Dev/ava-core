import type { D1Database } from "@cloudflare/workers-types";

/**
 * Withdrawal / settlement target architecture (account shard).
 *
 * - **Ledger** (`amount_ledger_whole`, future debits): product source of truth for how much the user is allowed to exit.
 * - **Custodial** (user ATA): receives deposits and intermediate custody; swept toward treasury.
 * - **Treasury**: pays network/ATA costs where policy requires; funds user-facing payout after settlement.
 * - **Legs** (`rr_settlement_leg`): ordered on-chain steps (custodial→treasury SPL, close ATA reclaim, treasury→user, …).
 *
 * This module only persists intents + legs and validates state transitions. Executors (cron / workers) plug in later.
 */

export const WITHDRAWAL_INTENT_STATUS = {
  draft: "draft",
  ledger_reserved: "ledger_reserved",
  custodial_sweep_queued: "custodial_sweep_queued",
  custodial_sweep_confirmed: "custodial_sweep_confirmed",
  treasury_payout_queued: "treasury_payout_queued",
  treasury_payout_confirmed: "treasury_payout_confirmed",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
} as const;

export type WithdrawalIntentStatus = (typeof WITHDRAWAL_INTENT_STATUS)[keyof typeof WITHDRAWAL_INTENT_STATUS];

export const SETTLEMENT_LEG_TYPE = {
  custodial_to_treasury_spl: "custodial_to_treasury_spl",
  custodial_to_treasury_native: "custodial_to_treasury_native",
  close_user_ata_reclaim_lamports: "close_user_ata_reclaim_lamports",
  treasury_to_destination_spl: "treasury_to_destination_spl",
  treasury_to_destination_native: "treasury_to_destination_native",
} as const;

export type SettlementLegType = (typeof SETTLEMENT_LEG_TYPE)[keyof typeof SETTLEMENT_LEG_TYPE];

export const SETTLEMENT_LEG_STATUS = {
  pending: "pending",
  submitted: "submitted",
  confirmed: "confirmed",
  skipped: "skipped",
  failed: "failed",
} as const;

export type SettlementLegStatus = (typeof SETTLEMENT_LEG_STATUS)[keyof typeof SETTLEMENT_LEG_STATUS];

export type WithdrawalIntentRow = {
  id: string;
  account_id: string;
  mint_base58: string;
  amount_ledger_whole: number;
  destination_pubkey: string;
  status: string;
  status_detail: string | null;
  created_at: string;
  updated_at: string;
  settled_at: string | null;
};

export type SettlementLegRow = {
  id: string;
  intent_id: string;
  step_index: number;
  leg_type: string;
  status: string;
  tx_signature: string | null;
  amount_raw: string | null;
  error_detail: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

/** Allowed single-step transitions (extend when executors land). */
const INTENT_TRANSITIONS: Record<WithdrawalIntentStatus, WithdrawalIntentStatus[]> = {
  [WITHDRAWAL_INTENT_STATUS.draft]: [
    WITHDRAWAL_INTENT_STATUS.ledger_reserved,
    WITHDRAWAL_INTENT_STATUS.cancelled,
  ],
  [WITHDRAWAL_INTENT_STATUS.ledger_reserved]: [
    WITHDRAWAL_INTENT_STATUS.custodial_sweep_queued,
    WITHDRAWAL_INTENT_STATUS.failed,
    WITHDRAWAL_INTENT_STATUS.cancelled,
  ],
  [WITHDRAWAL_INTENT_STATUS.custodial_sweep_queued]: [
    WITHDRAWAL_INTENT_STATUS.custodial_sweep_confirmed,
    WITHDRAWAL_INTENT_STATUS.failed,
  ],
  [WITHDRAWAL_INTENT_STATUS.custodial_sweep_confirmed]: [
    WITHDRAWAL_INTENT_STATUS.treasury_payout_queued,
    WITHDRAWAL_INTENT_STATUS.failed,
  ],
  [WITHDRAWAL_INTENT_STATUS.treasury_payout_queued]: [
    WITHDRAWAL_INTENT_STATUS.treasury_payout_confirmed,
    WITHDRAWAL_INTENT_STATUS.failed,
  ],
  [WITHDRAWAL_INTENT_STATUS.treasury_payout_confirmed]: [WITHDRAWAL_INTENT_STATUS.completed, WITHDRAWAL_INTENT_STATUS.failed],
  [WITHDRAWAL_INTENT_STATUS.completed]: [],
  [WITHDRAWAL_INTENT_STATUS.failed]: [],
  [WITHDRAWAL_INTENT_STATUS.cancelled]: [],
};

export function withdrawalIntentCanTransition(from: string, to: string): boolean {
  const f = from as WithdrawalIntentStatus;
  const t = to as WithdrawalIntentStatus;
  return INTENT_TRANSITIONS[f]?.includes(t) ?? false;
}

/** Static descriptor for clients / ops (no DB). */
export function withdrawalSettlementFrameworkDescriptor(): Record<string, unknown> {
  return {
    version: 1,
    authority: {
      withdraw_cap: "ledger_and_product_rules",
      on_chain_execution: "settlement_legs_treasury_and_custodial",
    },
    phases: [
      {
        key: "intent",
        title: "Withdrawal intent",
        detail: "User requests an amount capped by ledger / policy (not raw custodial read as the sole cap).",
      },
      {
        key: "ledger_reserve",
        title: "Ledger reserve (future)",
        detail: "Debit or lock the ledger line so the same units cannot be double-spent while settlement runs.",
      },
      {
        key: "custodial_sweep",
        title: "Custodial → treasury",
        detail: "Move SPL/native from the user custodial wallet to treasury-controlled accounts per policy.",
      },
      {
        key: "ata_reclaim",
        title: "ATA / rent reclaim",
        detail: "Close empty ATAs where safe; reclaim lamports to treasury.",
      },
      {
        key: "treasury_payout",
        title: "Treasury payout",
        detail: "Treasury funds the user destination transfer (fees + principal as designed).",
      },
      {
        key: "complete",
        title: "Complete",
        detail: "Mark intent settled; refresh caches / ledgers.",
      },
    ],
    intent_statuses: Object.values(WITHDRAWAL_INTENT_STATUS),
    leg_types: Object.values(SETTLEMENT_LEG_TYPE),
    leg_statuses: Object.values(SETTLEMENT_LEG_STATUS),
  };
}

export async function insertWithdrawalIntentDraft(
  db: D1Database,
  input: {
    accountId: string;
    mintBase58: string;
    amountLedgerWhole: number;
    destinationPubkey: string;
  },
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO rr_withdrawal_intent (
         id, account_id, mint_base58, amount_ledger_whole, destination_pubkey, status, status_detail, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .bind(
      id,
      input.accountId.trim(),
      input.mintBase58.trim(),
      Math.floor(input.amountLedgerWhole),
      input.destinationPubkey.trim(),
      WITHDRAWAL_INTENT_STATUS.draft,
      now,
      now,
    )
    .run();
  return { id };
}

export async function listWithdrawalIntentsForAccount(
  db: D1Database,
  accountId: string,
  limit = 50,
): Promise<WithdrawalIntentRow[]> {
  const lim = Math.min(200, Math.max(1, Math.floor(limit)));
  const r = await db
    .prepare(
      `SELECT id, account_id, mint_base58, amount_ledger_whole, destination_pubkey, status, status_detail,
              created_at, updated_at, settled_at
       FROM rr_withdrawal_intent
       WHERE account_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(accountId.trim(), lim)
    .all<WithdrawalIntentRow>();
  return (r.results || []).map((row) => ({
    id: String(row.id),
    account_id: String(row.account_id),
    mint_base58: String(row.mint_base58),
    amount_ledger_whole: Math.max(0, Math.floor(Number(row.amount_ledger_whole) || 0)),
    destination_pubkey: String(row.destination_pubkey),
    status: String(row.status),
    status_detail: row.status_detail != null ? String(row.status_detail) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    settled_at: row.settled_at != null ? String(row.settled_at) : null,
  }));
}

export async function getWithdrawalIntentForAccount(
  db: D1Database,
  intentId: string,
  accountId: string,
): Promise<WithdrawalIntentRow | null> {
  const row = await db
    .prepare(
      `SELECT id, account_id, mint_base58, amount_ledger_whole, destination_pubkey, status, status_detail,
              created_at, updated_at, settled_at
       FROM rr_withdrawal_intent
       WHERE id = ? AND account_id = ?`,
    )
    .bind(intentId.trim(), accountId.trim())
    .first<WithdrawalIntentRow>();
  if (!row?.id) return null;
  return {
    id: String(row.id),
    account_id: String(row.account_id),
    mint_base58: String(row.mint_base58),
    amount_ledger_whole: Math.max(0, Math.floor(Number(row.amount_ledger_whole) || 0)),
    destination_pubkey: String(row.destination_pubkey),
    status: String(row.status),
    status_detail: row.status_detail != null ? String(row.status_detail) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    settled_at: row.settled_at != null ? String(row.settled_at) : null,
  };
}

export async function updateWithdrawalIntentStatus(
  db: D1Database,
  intentId: string,
  accountId: string,
  nextStatus: WithdrawalIntentStatus,
  detail?: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cur = await getWithdrawalIntentForAccount(db, intentId, accountId);
  if (!cur) return { ok: false, reason: "not_found" };
  if (!withdrawalIntentCanTransition(cur.status as WithdrawalIntentStatus, nextStatus)) {
    return { ok: false, reason: "invalid_transition" };
  }
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE rr_withdrawal_intent
       SET status = ?, status_detail = ?, updated_at = ?,
           settled_at = CASE WHEN ? = ? THEN ? ELSE settled_at END
       WHERE id = ? AND account_id = ?`,
    )
    .bind(
      nextStatus,
      detail != null ? String(detail).slice(0, 2000) : null,
      now,
      nextStatus,
      WITHDRAWAL_INTENT_STATUS.completed,
      now,
      intentId.trim(),
      accountId.trim(),
    )
    .run();
  return { ok: true };
}

/** Template legs for an SPL-style path (executors fill signatures). */
export async function insertDefaultSettlementLegTemplate(
  db: D1Database,
  intentId: string,
  mintBase58: string,
): Promise<void> {
  const now = new Date().toISOString();
  const isNative = mintBase58.trim().toLowerCase() === "native";
  const legs: { step: number; type: SettlementLegType }[] = isNative
    ? [
        { step: 0, type: SETTLEMENT_LEG_TYPE.custodial_to_treasury_native },
        { step: 1, type: SETTLEMENT_LEG_TYPE.treasury_to_destination_native },
      ]
    : [
        { step: 0, type: SETTLEMENT_LEG_TYPE.custodial_to_treasury_spl },
        { step: 1, type: SETTLEMENT_LEG_TYPE.close_user_ata_reclaim_lamports },
        { step: 2, type: SETTLEMENT_LEG_TYPE.treasury_to_destination_spl },
      ];
  const stmts = legs.map((L) =>
    db
      .prepare(
        `INSERT INTO rr_settlement_leg (
           id, intent_id, step_index, leg_type, status, tx_signature, amount_raw, error_detail, metadata_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .bind(crypto.randomUUID(), intentId.trim(), L.step, L.type, SETTLEMENT_LEG_STATUS.pending, now, now),
  );
  await db.batch(stmts);
}

export async function listSettlementLegs(db: D1Database, intentId: string): Promise<SettlementLegRow[]> {
  const r = await db
    .prepare(
      `SELECT id, intent_id, step_index, leg_type, status, tx_signature, amount_raw, error_detail, metadata_json,
              created_at, updated_at
       FROM rr_settlement_leg
       WHERE intent_id = ?
       ORDER BY step_index ASC`,
    )
    .bind(intentId.trim())
    .all<SettlementLegRow>();
  return (r.results || []).map((row) => ({
    id: String(row.id),
    intent_id: String(row.intent_id),
    step_index: Math.floor(Number(row.step_index) || 0),
    leg_type: String(row.leg_type),
    status: String(row.status),
    tx_signature: row.tx_signature != null ? String(row.tx_signature) : null,
    amount_raw: row.amount_raw != null ? String(row.amount_raw) : null,
    error_detail: row.error_detail != null ? String(row.error_detail) : null,
    metadata_json: row.metadata_json != null ? String(row.metadata_json) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }));
}

export async function withdrawalIntentStatusCounts(db: D1Database): Promise<Record<string, number>> {
  const r = await db
    .prepare("SELECT status, COUNT(*) AS c FROM rr_withdrawal_intent GROUP BY status")
    .all<{ status: string; c: number }>();
  const out: Record<string, number> = {};
  for (const row of r.results || []) {
    out[String(row.status)] = Math.max(0, Math.floor(Number(row.c) || 0));
  }
  return out;
}
