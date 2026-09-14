import { json } from "../cors";
import { validateG2ServerAuth } from "./g2-auth";
import { msToIso, nowMs, str, type G2Env } from "./g2-db";

export async function listG2PendingGoldTransfers(request: Request, env: G2Env): Promise<Response> {
  const server = await validateG2ServerAuth(env, request);
  if (server instanceof Response) return server;

  const { results } = await env.DB.prepare(
    `SELECT id, to_uuid AS to_uuid, to_username, amount_g AS amount, source, created_at_ms
     FROM g2_gold_transfer
     WHERE realm_id = ? AND status = 'pending'
     ORDER BY created_at_ms ASC
     LIMIT 50`,
  )
    .bind(server.realmId)
    .all<Record<string, unknown>>();

  const transfers = (results || []).map((row) => ({
    id: row.id,
    from_uuid: "",
    from_username: null,
    to_uuid: row.to_uuid,
    to_username: row.to_username,
    amount: row.amount,
    source: row.source,
    created_at: msToIso(Number(row.created_at_ms)),
  }));

  return json({ ok: true, transfers });
}

export async function completeG2GoldTransfers(request: Request, env: G2Env): Promise<Response> {
  const server = await validateG2ServerAuth(env, request);
  if (server instanceof Response) return server;

  let body: { transfers?: unknown[] };
  try {
    body = (await request.json()) as { transfers?: unknown[] };
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }

  const rows = Array.isArray(body.transfers) ? body.transfers : [];
  let updated = 0;

  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = str(row.id);
    const status = str(row.status).toLowerCase();
    if (!id || (status !== "applied" && status !== "failed")) continue;

    const errorMessage =
      status === "failed" ? str(row.error_message || row.error).slice(0, 500) || null : null;
    const res = await env.DB.prepare(
      `UPDATE g2_gold_transfer
       SET status = ?, applied_at_ms = ?, details_json = COALESCE(details_json, ?)
       WHERE id = ? AND realm_id = ? AND status = 'pending'`,
    )
      .bind(status, nowMs(), errorMessage ? JSON.stringify({ error: errorMessage }) : null, id, server.realmId)
      .run();

    if ((res.meta?.changes ?? 0) >= 1) updated++;
  }

  return json({ ok: true, updated, rolled_back: 0 });
}
