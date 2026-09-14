import { json } from "./cors";
import { verifyWorkerOpsAdmin } from "./push";

export interface DeveloperMessagesEnv {
  DB: D1Database;
  RR_PUSH_ADMIN_SECRET?: string;
}

/** Map RR_APP_ID-style string to a single scope bucket for filtering rows. */
function scopeForAppId(appId: string): "weather" | "bm" | "token_manager" | "account_hub" {
  const a = appId.toLowerCase();
  if (a.includes("business_manager")) return "bm";
  if (a.includes("token_manager")) return "token_manager";
  if (a.includes("account_hub")) return "account_hub";
  if (a.includes("weather")) return "weather";
  return "weather";
}

/** GET /api/mobile/developer-messages?app_id=… — newest first, no auth. */
export async function handleDeveloperMessagesGet(env: DeveloperMessagesEnv, url: URL): Promise<Response> {
  const appId = (url.searchParams.get("app_id") || "").trim();
  try {
    if (!appId) {
      const { results } = await env.DB.prepare(
        `SELECT id, title, body, app_scope AS app_scope, created_at FROM developer_messages
         WHERE app_scope = 'all' ORDER BY datetime(created_at) DESC LIMIT 50`
      ).all<{ id: string; title: string; body: string; app_scope: string; created_at: string }>();
      return json({ messages: results || [] }, 200);
    }
    const scope = scopeForAppId(appId);
    const { results } = await env.DB.prepare(
      `SELECT id, title, body, app_scope AS app_scope, created_at
       FROM developer_messages
       WHERE app_scope = 'all' OR app_scope = ?
       ORDER BY datetime(created_at) DESC
       LIMIT 50`
    )
      .bind(scope)
      .all<{ id: string; title: string; body: string; app_scope: string; created_at: string }>();
    return json({ messages: results || [] }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ detail: `Could not load messages: ${msg}`, messages: [] }, 500);
  }
}

/** POST /api/internal/developer-messages — append a row (X-RR-Push-Admin-Key). */
export async function handleDeveloperMessagesPost(request: Request, env: DeveloperMessagesEnv): Promise<Response> {
  if (!(await verifyWorkerOpsAdmin(request, env))) {
    const has = Boolean(request.headers.get("X-RR-Push-Admin-Key"));
    return json({ detail: has ? "Invalid admin key." : "Missing X-RR-Push-Admin-Key header." }, 401);
  }
  let body: { title?: string; body?: string; app_scope?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON." }, 400);
  }
  const title = String(body.title || "").trim();
  const text = String(body.body || "").trim();
  const rawScope = String(body.app_scope || "all").trim().toLowerCase();
  const app_scope = ["all", "weather", "bm", "token_manager", "account_hub"].includes(rawScope) ? rawScope : "all";
  if (!title || title.length > 200) return json({ detail: "title required (1–200 chars)." }, 400);
  if (!text || text.length > 8000) return json({ detail: "body required (1–8000 chars)." }, 400);
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO developer_messages (id, title, body, app_scope, created_at) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(id, title, text, app_scope, created_at)
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ detail: msg }, 500);
  }
  return json({ ok: true, id, app_scope, created_at }, 200);
}
