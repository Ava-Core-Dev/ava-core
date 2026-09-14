/**
 * Mirrored current_connection_preference (local edge is authoritative writer).
 * Public GET; authenticated PUT from local-edge / workstation key.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { validateDevWorkstationAuth, type DevWorkstationEnv } from "./rootmc-dev-workstation";

export type ConnectionPreferenceEnv = DevWorkstationEnv & {
  DB: D1Database;
  ROOTMC_EDGE_SIGNING_KEY?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ZONE_ID?: string;
  ROOTMC_TUNNEL_HEALTH_URL?: string;
};

export type ConnectionPreferencePayload = {
  preference: "local" | "cloudflare";
  /** Public display name: solar when preference is local. */
  active_provider?: "solar" | "cloudflare";
  /** Discord display name of signed-in Root-Core-Node operator (when Solar). */
  node_discord_username?: string | null;
  reason?: string;
  checked_at?: string;
  local_health?: string;
  schedule_allows_local?: boolean;
  surfaces?: Record<string, string>;
  source?: string;
  sync_status?: string;
};

const DEFAULT_PREF: ConnectionPreferencePayload = {
  preference: "cloudflare",
  active_provider: "cloudflare",
  reason: "default_cloudflare",
  checked_at: new Date(0).toISOString(),
  local_health: "unknown",
  schedule_allows_local: false,
  surfaces: { api: "cloudflare", api2: "cloudflare", site: "cloudflare", map: "cloudflare" },
  source: "worker_default",
};

function withActiveProvider(payload: ConnectionPreferencePayload): ConnectionPreferencePayload {
  const preference = payload.preference === "local" ? "local" : "cloudflare";
  const nodeName = String(payload.node_discord_username || "").trim().slice(0, 64);
  return {
    ...payload,
    preference,
    active_provider: preference === "local" ? "solar" : "cloudflare",
    // Only expose node operator while Solar is active
    node_discord_username: preference === "local" && nodeName ? nodeName : null,
  };
}

async function ensureTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS rootmc_connection_preference (
         id TEXT PRIMARY KEY NOT NULL,
         payload_json TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
    )
    .run();
}

export async function readConnectionPreference(db: D1Database): Promise<ConnectionPreferencePayload> {
  try {
    await ensureTable(db);
    const row = await db
      .prepare(`SELECT payload_json FROM rootmc_connection_preference WHERE id = 'primary' LIMIT 1`)
      .first<{ payload_json: string }>();
    if (!row?.payload_json) return { ...DEFAULT_PREF };
    const parsed = JSON.parse(row.payload_json) as ConnectionPreferencePayload;
    if (parsed.preference !== "local" && parsed.preference !== "cloudflare") {
      return { ...DEFAULT_PREF };
    }
    return withActiveProvider(parsed);
  } catch {
    return { ...DEFAULT_PREF };
  }
}

export async function writeConnectionPreference(
  db: D1Database,
  payload: ConnectionPreferencePayload,
): Promise<ConnectionPreferencePayload> {
  await ensureTable(db);
  const next: ConnectionPreferencePayload = withActiveProvider({
    preference: payload.preference === "local" ? "local" : "cloudflare",
    node_discord_username: payload.node_discord_username,
    reason: String(payload.reason || "").slice(0, 200) || "updated",
    checked_at: String(payload.checked_at || new Date().toISOString()),
    local_health: String(payload.local_health || "unknown").slice(0, 64),
    schedule_allows_local: Boolean(payload.schedule_allows_local),
    surfaces: payload.surfaces || {
      api: payload.preference,
      api2: payload.preference,
      site: payload.preference,
      map: payload.preference,
    },
    source: String(payload.source || "api").slice(0, 64),
    sync_status: payload.sync_status ? String(payload.sync_status).slice(0, 64) : undefined,
  });
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO rootmc_connection_preference (id, payload_json, updated_at)
       VALUES ('primary', ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
    )
    .bind(JSON.stringify(next), now)
    .run();
  return next;
}

function isPrefSub(sub: string): boolean {
  const s = sub.replace(/\/+$/, "") || "/";
  return (
    s === "/rootmc/connection-preference"
    || s === "/connection-preference"
    || s === "/rootmc/connection_preference"
  );
}

export async function handleConnectionPreferenceRoutes(
  request: Request,
  env: ConnectionPreferenceEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (!isPrefSub(sub)) return null;

  if (method === "GET") {
    const pref = await readConnectionPreference(env.DB);
    return json(pref, 200, {
      "Cache-Control": "public, max-age=5, stale-while-revalidate=30",
      "X-RootMC-Cacheable": "1",
    });
  }

  if (method === "PUT" || method === "POST") {
    if (!validateDevWorkstationAuth(request, env)) {
      return json({ detail: "Unauthorized." }, 401);
    }
    let body: ConnectionPreferencePayload;
    try {
      body = (await request.json()) as ConnectionPreferencePayload;
    } catch {
      return json({ detail: "Invalid JSON" }, 400);
    }
    const prefIn = String((body as { preference?: string }).preference || "");
    if (prefIn !== "local" && prefIn !== "cloudflare" && prefIn !== "solar") {
      return json({ detail: "preference must be local|solar|cloudflare" }, 400);
    }
    body.preference = prefIn === "solar" ? "local" : prefIn === "local" ? "local" : "cloudflare";
    body.source = body.source || "local_edge";
    const saved = await writeConnectionPreference(env.DB, body);
    return json({ ok: true, preference: saved }, 200, { "Cache-Control": "no-store" });
  }

  return json({ detail: "Method Not Allowed" }, 405);
}

/** Abrupt-offline watchdog: if mirrored preference is local but tunnel health fails, force cloudflare.
 * Restore Solar (local) when the tunnel is healthy again so the public badge stays green while connected.
 */
export async function runConnectionPreferenceWatchdogCron(
  env: ConnectionPreferenceEnv,
): Promise<{ ok: boolean; detail: string; flipped: boolean }> {
  const pref = await readConnectionPreference(env.DB);
  const healthUrl = String(env.ROOTMC_TUNNEL_HEALTH_URL || "").trim();
  if (!healthUrl) {
    return { ok: true, detail: "no_tunnel_health_url_configured", flipped: false };
  }
  let healthy = false;
  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "RootMC/edge-watchdog" },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const text = await res.text();
      healthy = /"status"\s*:\s*"ok"/i.test(text) || /"db"\s*:\s*"ok"/i.test(text) || text.includes('"ok"');
      if (!healthy && res.headers.get("content-type")?.includes("json")) {
        try {
          const j = JSON.parse(text) as { status?: string; db?: string; ok?: boolean };
          healthy = j.status === "ok" || j.db === "ok" || j.ok === true;
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    healthy = false;
  }
  if (healthy) {
    if (pref.preference === "local") {
      return { ok: true, detail: "tunnel_health_ok", flipped: false };
    }
    await writeConnectionPreference(env.DB, {
      preference: "local",
      reason: "watchdog_tunnel_healthy",
      checked_at: new Date().toISOString(),
      local_health: "ok",
      schedule_allows_local: true,
      surfaces: { api: "local", api2: "local", site: "local", map: "local" },
      source: "cf_watchdog",
    });
    return { ok: true, detail: "restored_to_solar", flipped: true };
  }
  if (pref.preference !== "local") {
    return { ok: true, detail: "preference_already_cloudflare_or_ok", flipped: false };
  }
  await writeConnectionPreference(env.DB, {
    preference: "cloudflare",
    reason: "watchdog_tunnel_unhealthy",
    checked_at: new Date().toISOString(),
    local_health: "failed",
    schedule_allows_local: pref.schedule_allows_local,
    surfaces: { api: "cloudflare", api2: "cloudflare", site: "cloudflare", map: "cloudflare" },
    source: "cf_watchdog",
  });
  return { ok: true, detail: "flipped_to_cloudflare", flipped: true };
}
