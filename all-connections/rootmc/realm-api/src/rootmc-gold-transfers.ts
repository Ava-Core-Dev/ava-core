import type { D1Database } from "@cloudflare/workers-types";

import { roundGold } from "./discord-rootmc-economy";
import { json } from "./cors";
import type { RootStatEnv } from "./rootstat-minecraft";
import { validateServerAuth } from "./rootstat-minecraft";

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

type GoldTransferRow = {
  id: string;
  from_uuid: string;
  to_uuid: string;
  amount: number;
  source: string;
};

/** UUIDs with a pending Discord pay  -  Vault sync must not overwrite D1 balances for these players. */
export async function pendingTransferUuidSet(db: D1Database, serverId: string): Promise<Set<string>> {
  try {
    const { results } = await db
      .prepare(
        `SELECT from_uuid, to_uuid
         FROM rootmc_gold_transfers
         WHERE server_id = ? AND status = 'pending'`,
      )
      .bind(serverId)
      .all<{ from_uuid: string; to_uuid: string }>();

    const out = new Set<string>();
    for (const row of results || []) {
      const from = str(row.from_uuid).toLowerCase();
      const to = str(row.to_uuid).toLowerCase();
      if (from) out.add(from);
      if (to) out.add(to);
    }
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("pendingTransferUuidSet_skip", serverId, msg.slice(0, 200));
    return new Set();
  }
}

/** Undo D1 balance movement when Vault could not apply the transfer. */
export async function rollbackFailedGoldTransfer(
  db: D1Database,
  serverId: string,
  transfer: GoldTransferRow,
): Promise<void> {
  const amount = roundGold(Number(transfer.amount));
  const fromUuid = str(transfer.from_uuid).toLowerCase();
  const toUuid = str(transfer.to_uuid).toLowerCase();
  if (!fromUuid || !toUuid || amount < 0.01) return;

  const ts = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE rootstat_player_balances
         SET balance = balance + ?, updated_at = ?, synced_at = ?
         WHERE server_id = ? AND minecraft_uuid = ?`,
      )
      .bind(amount, ts, ts, serverId, fromUuid),
    db
      .prepare(
        `UPDATE rootstat_player_balances
         SET balance = MAX(0, balance - ?), updated_at = ?, synced_at = ?
         WHERE server_id = ? AND minecraft_uuid = ?`,
      )
      .bind(amount, ts, ts, serverId, toUuid),
    db
      .prepare(
        `UPDATE rootstat_player_net_worth
         SET balance_value = balance_value + ?, total_value = total_value + ?, synced_at = ?
         WHERE server_id = ? AND minecraft_uuid = ?`,
      )
      .bind(amount, amount, ts, serverId, fromUuid),
    db
      .prepare(
        `UPDATE rootstat_player_net_worth
         SET balance_value = MAX(0, balance_value - ?), total_value = MAX(0, total_value - ?), synced_at = ?
         WHERE server_id = ? AND minecraft_uuid = ?`,
      )
      .bind(amount, amount, ts, serverId, toUuid),
  ]);
}

export async function listPendingGoldTransfers(request: Request, env: RootStatEnv): Promise<Response> {
  const server = await validateServerAuth(env, request);
  if (server instanceof Response) return server;

  // Only this host's transfers — avoids Towny/Claims dual-apply races on multi-host.
  const { results } = await env.DB.prepare(
    `SELECT id, from_uuid, from_username, to_uuid, to_username, amount, source, created_at
     FROM rootmc_gold_transfers
     WHERE server_id = ? AND status = 'pending'
     ORDER BY created_at ASC
     LIMIT 200`,
  )
    .bind(server.serverId)
    .all<Record<string, unknown>>();

  return json({ ok: true, transfers: results || [] });
}

export async function completeGoldTransfers(request: Request, env: RootStatEnv): Promise<Response> {
  const server = await validateServerAuth(env, request);
  if (server instanceof Response) return server;

  let body: { transfers?: unknown[] };
  try {
    body = (await request.json()) as { transfers?: unknown[] };
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }

  const rows = Array.isArray(body.transfers) ? body.transfers : [];
  const ts = nowIso();
  let updated = 0;
  let rolledBack = 0;

  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = str(row.id);
    const status = str(row.status).toLowerCase();
    if (!id || (status !== "applied" && status !== "failed")) continue;

    const pending = await env.DB.prepare(
      `SELECT id, from_uuid, to_uuid, amount, source
       FROM rootmc_gold_transfers
       WHERE id = ? AND server_id = ? AND status = 'pending'
       LIMIT 1`,
    )
      .bind(id, server.serverId)
      .first<GoldTransferRow>();

    if (!pending) continue;

    const errorMessage = status === "failed" ? str(row.error_message || row.error).slice(0, 500) || null : null;
    const res = await env.DB.prepare(
      `UPDATE rootmc_gold_transfers
       SET status = ?, applied_at = ?, error_message = ?
       WHERE id = ? AND server_id = ? AND status = 'pending'`,
    )
      .bind(status, ts, errorMessage, id, server.serverId)
      .run();

    if ((res.meta?.changes ?? 0) < 1) continue;
    updated++;

    if (status === "failed" && str(pending.source) === "discord") {
      await rollbackFailedGoldTransfer(env.DB, server.serverId, pending);
      rolledBack++;
    }
  }

  return json({ ok: true, updated, rolled_back: rolledBack });
}
