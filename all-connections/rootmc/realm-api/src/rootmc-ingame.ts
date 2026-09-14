import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { requireSignedInAccount, str, record } from "./realm-lib";
import type { RootStatEnv } from "./rootstat-minecraft";
import { validateServerAuth } from "./rootstat-minecraft";

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeUuid(raw: string): string | null {
  const uuid = str(raw).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
    return null;
  }
  return uuid;
}

async function accountIdForUuid(db: D1Database, uuid: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT account_id FROM rootstat_minecraft_links WHERE minecraft_uuid = ? LIMIT 1`)
    .bind(uuid)
    .first<{ account_id: string }>();
  return row?.account_id ? str(row.account_id) : null;
}

export async function handleRootMcIngame(
  request: Request,
  env: RootStatEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/ingame-events")) return null;

  if (method === "POST" && subpath === "/rootmc/ingame-events") {
    const server = await validateServerAuth(env, request);
    if (server instanceof Response) return server;

    let body: Record<string, unknown>;
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }

    const events = Array.isArray(body.events) ? body.events : [];
    let inserted = 0;
    const now = nowIso();

    for (const raw of events) {
      const row = record(raw);
      const uuid = normalizeUuid(str(row.minecraft_uuid));
      const eventType = str(row.event_type).toLowerCase();
      const worldName = str(row.world_name);
      if (!uuid || !eventType || !worldName) continue;
      if (eventType !== "waypoint" && eventType !== "note") continue;

      const accountId = await accountIdForUuid(env.DB, uuid);
      await env.DB.prepare(
        `INSERT INTO rootmc_ingame_events
           (server_id, minecraft_uuid, minecraft_username, account_id, event_type,
            world_name, dimension, x, y, z, label, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          server.serverId,
          uuid,
          str(row.minecraft_username) || null,
          accountId,
          eventType,
          worldName,
          str(row.dimension) || "overworld",
          Number(row.x) || 0,
          Number(row.y) || 0,
          Number(row.z) || 0,
          str(row.label) || null,
          str(row.body) || null,
          str(row.created_at) || now,
        )
        .run();
      inserted++;
    }

    return json({ ok: true, server_id: server.serverId, inserted, synced_at: now });
  }

  if (method === "GET" && subpath === "/rootmc/ingame-events") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;

    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const since = str(url.searchParams.get("since"));

    const { results } = since
      ? await env.DB.prepare(
          `SELECT id, server_id, event_type, world_name, dimension, x, y, z, label, body, created_at
           FROM rootmc_ingame_events
           WHERE account_id = ? AND consumed_at IS NULL AND created_at > ?
           ORDER BY created_at ASC
           LIMIT ?`,
        )
          .bind(auth.accountId, since, limit)
          .all<Record<string, unknown>>()
      : await env.DB.prepare(
          `SELECT id, server_id, event_type, world_name, dimension, x, y, z, label, body, created_at
           FROM rootmc_ingame_events
           WHERE account_id = ? AND consumed_at IS NULL
           ORDER BY created_at ASC
           LIMIT ?`,
        )
          .bind(auth.accountId, limit)
          .all<Record<string, unknown>>();

    return json({
      account_id: auth.accountId,
      events: results || [],
      synced_at: nowIso(),
    });
  }

  if (method === "POST" && subpath === "/rootmc/ingame-events/ack") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;

    let body: Record<string, unknown>;
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }

    const ids = Array.isArray(body.event_ids)
      ? body.event_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
      : [];
    const now = nowIso();
    for (const id of ids) {
      await env.DB.prepare(
        `UPDATE rootmc_ingame_events
         SET consumed_at = ?, synced_to_account_at = ?
         WHERE id = ? AND account_id = ?`,
      )
        .bind(now, now, id, auth.accountId)
        .run();
    }

    return json({ ok: true, acked: ids.length });
  }

  return json({ detail: "Not Found" }, 404);
}
