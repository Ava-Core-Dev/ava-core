import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import type { AuthEnv } from "./primary-auth";
import { requireSignedInAccount } from "./realm-lib";

type SyncEnv = AuthEnv;

const SNAPSHOT_SCHEMA_VERSION = 1;
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;

/** Table created in migration 0084_rootmc_account_snapshot.sql; keep as safety net. */
let syncSchemaEnsured = false;

async function ensureSyncTable(db: D1Database): Promise<void> {
  if (syncSchemaEnsured) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS rootmc_account_snapshot (
        account_id TEXT PRIMARY KEY,
        doc TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        device_id TEXT
      )`,
    )
    .run();
  syncSchemaEnsured = true;
}

function deviceIdFromRequest(request: Request): string | null {
  const guest = (request.headers.get("X-Guest-Id") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return guest || null;
}

function parseExportedAt(body: Record<string, unknown>): number {
  const direct = Number(body.exported_at ?? body.exportedAt ?? 0);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
  const snap = body.snapshot;
  if (snap && typeof snap === "object" && !Array.isArray(snap)) {
    const nested = Number((snap as Record<string, unknown>).exported_at ?? (snap as Record<string, unknown>).exportedAt ?? 0);
    if (Number.isFinite(nested) && nested > 0) return Math.floor(nested);
  }
  return Date.now();
}

export async function handleRootMcSync(
  request: Request,
  env: SyncEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (sub !== "/sync/snapshot") return null;

  const auth = await requireSignedInAccount(request, env);
  if (auth instanceof Response) {
    return json({ detail: "Sign in required to sync Block Notes data." }, 401);
  }

  await ensureSyncTable(env.DB);

  if (method === "GET") {
    const row = await env.DB.prepare(
      "SELECT doc, schema_version, updated_at, device_id FROM rootmc_account_snapshot WHERE account_id = ? LIMIT 1",
    )
      .bind(auth.accountId)
      .first<{ doc: string; schema_version: number; updated_at: string; device_id: string | null }>();

    if (!row?.doc) {
      return json({ empty: true, account_id: auth.accountId }, 200);
    }

    let snapshot: unknown;
    try {
      snapshot = JSON.parse(row.doc);
    } catch {
      return json({ detail: "Stored snapshot is corrupt." }, 500);
    }

    const updatedMs = Date.parse(row.updated_at);
    return json(
      {
        account_id: auth.accountId,
        schema_version: row.schema_version ?? SNAPSHOT_SCHEMA_VERSION,
        updated_at: Number.isFinite(updatedMs) ? updatedMs : Date.now(),
        updated_at_iso: row.updated_at,
        device_id: row.device_id,
        snapshot,
      },
      200,
    );
  }

  if (method === "PUT") {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ detail: "Invalid JSON." }, 400);
    }

    const snapshot = body.snapshot ?? body;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return json({ detail: "snapshot object is required." }, 400);
    }

    const doc = JSON.stringify(snapshot);
    if (doc.length > MAX_SNAPSHOT_BYTES) {
      return json({ detail: `Snapshot too large (max ${MAX_SNAPSHOT_BYTES} bytes).` }, 413);
    }

    const schemaVersion = Number(body.schema_version ?? body.schemaVersion ?? SNAPSHOT_SCHEMA_VERSION) || SNAPSHOT_SCHEMA_VERSION;
    const exportedAt = parseExportedAt(body);
    const updatedAt = new Date(exportedAt).toISOString();
    const deviceId = deviceIdFromRequest(request);

    await env.DB.prepare(
      `INSERT INTO rootmc_account_snapshot (account_id, doc, schema_version, updated_at, device_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         doc = excluded.doc,
         schema_version = excluded.schema_version,
         updated_at = excluded.updated_at,
         device_id = excluded.device_id`,
    )
      .bind(auth.accountId, doc, schemaVersion, updatedAt, deviceId)
      .run();

    return json(
      {
        ok: true,
        account_id: auth.accountId,
        schema_version: schemaVersion,
        updated_at: exportedAt,
        updated_at_iso: updatedAt,
      },
      200,
    );
  }

  return json({ detail: "Method not allowed" }, 405);
}
