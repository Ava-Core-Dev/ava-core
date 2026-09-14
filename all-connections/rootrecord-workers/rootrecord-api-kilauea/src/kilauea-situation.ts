import { json } from "./cors";
import { verifyWorkerOpsAdmin } from "./push";

export interface KilaueaSituationEnv {
  DB: D1Database;
  RR_PUSH_ADMIN_SECRET?: string;
}

export type KilaueaSituationRow = {
  id: string;
  name: string;
  enabled: number;
  body: string;
  updated_at: string;
};

const SITUATION_ID = "current";

function rowToJson(row: KilaueaSituationRow) {
  return {
    id: row.id,
    name: row.name,
    enabled: Boolean(row.enabled),
    body: row.body,
    updated_at: row.updated_at,
  };
}

async function loadSituationRow(db: D1Database): Promise<KilaueaSituationRow | null> {
  return db
    .prepare(
      `SELECT id, name, enabled, body, updated_at
       FROM kilauea_situation
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(SITUATION_ID)
    .first<KilaueaSituationRow>();
}

/**
 * GET /api/mobile/kilauea-situation — singleton event page config for the Kīlauea app.
 */
export async function handleKilaueaSituationGet(env: KilaueaSituationEnv): Promise<Response> {
  try {
    const row = await loadSituationRow(env.DB);
    if (!row) return json({ situation: null }, 200);
    return json({ situation: rowToJson(row) }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ detail: `Could not load situation: ${msg}`, situation: null }, 500);
  }
}

/**
 * POST /api/internal/kilauea-situation — enable/disable or update the remote event page (X-RR-Push-Admin-Key).
 * Body: { enabled?: boolean, name?: string, body?: string }
 * When enabling, `name` must be non-empty (after merge with existing row).
 */
export async function handleKilaueaSituationPost(
  request: Request,
  env: KilaueaSituationEnv,
): Promise<Response> {
  if (!(await verifyWorkerOpsAdmin(request, env))) {
    const has = Boolean(request.headers.get("X-RR-Push-Admin-Key"));
    return json({ detail: has ? "Invalid admin key." : "Missing X-RR-Push-Admin-Key header." }, 401);
  }

  let body: { enabled?: boolean; name?: string; body?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON." }, 400);
  }

  const existing = await loadSituationRow(env.DB);
  const enabled =
    body.enabled !== undefined ? Boolean(body.enabled) : Boolean(existing?.enabled ?? false);
  const name =
    body.name !== undefined
      ? String(body.name || "").trim().slice(0, 200)
      : String(existing?.name || "").trim().slice(0, 200);
  const situationBody =
    body.body !== undefined
      ? String(body.body || "").trim().slice(0, 50_000)
      : String(existing?.body || "").trim().slice(0, 50_000);

  if (enabled && !name) {
    return json({ detail: "name is required when enabled=true (SITUATION_NAME)." }, 400);
  }

  const updated_at = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO kilauea_situation (id, name, enabled, body, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         enabled = excluded.enabled,
         body = excluded.body,
         updated_at = excluded.updated_at`,
    )
      .bind(SITUATION_ID, name, enabled ? 1 : 0, situationBody, updated_at)
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ detail: msg }, 500);
  }

  return json(
    {
      ok: true,
      situation: {
        id: SITUATION_ID,
        name,
        enabled,
        body: situationBody,
        updated_at,
      },
    },
    200,
  );
}
