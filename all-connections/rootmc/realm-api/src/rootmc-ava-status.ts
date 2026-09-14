/**
 * Ava status / mood snapshots → D1 (always-readable from api.rootmc.net).
 * Ava node POSTs; edge Worker / public GET for history.
 */
import { json } from "./cors";
import {
  validateDevWorkstationAuth,
  type DevWorkstationEnv,
} from "./rootmc-dev-workstation";
import type { D1Database } from "@cloudflare/workers-types";

export type AvaStatusEnv = DevWorkstationEnv & {
  DB: D1Database;
};

async function ensureAvaStatusTables(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS rootmc_ava_status_latest (
         host_key TEXT PRIMARY KEY,
         mood TEXT,
         mood_label TEXT,
         lockout INTEGER NOT NULL DEFAULT 0,
         brain_mode TEXT,
         payload_json TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS rootmc_ava_status_snapshots (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         host_key TEXT NOT NULL,
         mood TEXT,
         mood_label TEXT,
         lockout INTEGER NOT NULL DEFAULT 0,
         brain_mode TEXT,
         payload_json TEXT NOT NULL,
         sampled_at INTEGER NOT NULL,
         created_at TEXT NOT NULL
       )`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_ava_status_snap_at
       ON rootmc_ava_status_snapshots (host_key, sampled_at DESC)`,
    )
    .run();
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

/**
 * Routes under /api/rootmc/ava/...
 * Returns null if not matched.
 */
export async function handleAvaStatusRoutes(
  req: Request,
  env: AvaStatusEnv,
  subpath: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/ava")) return null;
  const rest = subpath.slice("/rootmc/ava".length) || "/";

  if (req.method === "GET" && (rest === "/status" || rest === "/status/")) {
    await ensureAvaStatusTables(env.DB);
    const row = await env.DB.prepare(
      `SELECT mood, mood_label, lockout, brain_mode, payload_json, updated_at
       FROM rootmc_ava_status_latest WHERE host_key = ? LIMIT 1`,
    )
      .bind("primary")
      .first<{
        mood: string;
        mood_label: string;
        lockout: number;
        brain_mode: string;
        payload_json: string;
        updated_at: string;
      }>();
    if (!row?.payload_json) {
      return json({ ok: true, status: null });
    }
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      payload = {};
    }
    return json({
      ok: true,
      updated_at: row.updated_at,
      mood: row.mood,
      mood_label: row.mood_label,
      lockout: Boolean(row.lockout),
      brain_mode: row.brain_mode,
      status: payload,
    });
  }

  if (req.method === "GET" && (rest === "/status/history" || rest === "/status/history/")) {
    await ensureAvaStatusTables(env.DB);
    const url = new URL(req.url);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 60)));
    const since = Number(url.searchParams.get("since") || 0);
    const sinceMs = Number.isFinite(since) && since > 0 ? since : 0;
    const rows = sinceMs
      ? await env.DB.prepare(
          `SELECT mood, mood_label, lockout, brain_mode, sampled_at, created_at
           FROM rootmc_ava_status_snapshots
           WHERE host_key = ? AND sampled_at >= ?
           ORDER BY sampled_at DESC LIMIT ?`,
        )
          .bind("primary", sinceMs, limit)
          .all()
      : await env.DB.prepare(
          `SELECT mood, mood_label, lockout, brain_mode, sampled_at, created_at
           FROM rootmc_ava_status_snapshots
           WHERE host_key = ?
           ORDER BY sampled_at DESC LIMIT ?`,
        )
          .bind("primary", limit)
          .all();
    return json({ ok: true, samples: rows?.results || [], since: sinceMs || null });
  }

  if (req.method === "POST" && (rest === "/status" || rest === "/status/")) {
    if (!validateDevWorkstationAuth(req, env)) {
      return json({ ok: false, detail: "unauthorized" }, 401);
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, detail: "invalid_json" }, 400);
    }
    await ensureAvaStatusTables(env.DB);
    const now = new Date().toISOString();
    const sampledAt = Number(body?.sampledAt || body?.at || Date.now());
    const mood = str(body?.mood || body?.ops?.mood || "");
    const moodLabel = str(body?.moodLabel || body?.ops?.moodLabel || mood);
    const lockout = body?.lockout || body?.ops?.lockout ? 1 : 0;
    const brainMode = str(
      body?.brainMode || body?.ops?.brain?.mode || body?.brain?.mode || "",
    );
    const payload = JSON.stringify(body || {});

    await env.DB.prepare(
      `INSERT INTO rootmc_ava_status_latest
         (host_key, mood, mood_label, lockout, brain_mode, payload_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(host_key) DO UPDATE SET
         mood = excluded.mood,
         mood_label = excluded.mood_label,
         lockout = excluded.lockout,
         brain_mode = excluded.brain_mode,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
    )
      .bind("primary", mood || null, moodLabel || null, lockout, brainMode || null, payload, now)
      .run();

    // History: at most one row per ~2 minutes (avoid flood)
    const recent = await env.DB.prepare(
      `SELECT sampled_at FROM rootmc_ava_status_snapshots
       WHERE host_key = ? ORDER BY sampled_at DESC LIMIT 1`,
    )
      .bind("primary")
      .first<{ sampled_at: number }>();
    const lastAt = Number(recent?.sampled_at || 0);
    let inserted = 0;
    if (!lastAt || sampledAt - lastAt >= 120_000) {
      await env.DB.prepare(
        `INSERT INTO rootmc_ava_status_snapshots
           (host_key, mood, mood_label, lockout, brain_mode, payload_json, sampled_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          "primary",
          mood || null,
          moodLabel || null,
          lockout,
          brainMode || null,
          payload,
          sampledAt,
          now,
        )
        .run();
      inserted = 1;
    }

    return json({ ok: true, updated_at: now, history_inserted: inserted });
  }

  return null;
}
