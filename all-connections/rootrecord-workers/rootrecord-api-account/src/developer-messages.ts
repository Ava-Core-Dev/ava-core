import { json } from "./cors";
import { verifyWorkerOpsAdmin } from "./push";

export interface DeveloperMessagesEnv {
  DB: D1Database;
  RR_PUSH_ADMIN_SECRET?: string;
}

/** Mobile in-app developer message scopes (includes products without Global Updater feeds). */
const DEVELOPER_MESSAGE_SCOPES = [
  "releases",
  "weather",
  "bm",
  "token_manager",
  "account_hub",
  "kilauea",
  "blocknotes",
  "root_goals",
  "root_farms",
  "solana",
  "visiting_hawaii",
] as const;

type DeveloperMessageScope = (typeof DEVELOPER_MESSAGE_SCOPES)[number];

/**
 * Map RR_APP_ID-style string to a single scope bucket for filtering rows. Must stay in lockstep
 * with `discord-developer-sync.ts` (write side: hashtag -> scope) and the POST allow-list below.
 */
function scopeForAppId(appId: string): DeveloperMessageScope | "all" {
  const a = appId.toLowerCase();
  if (a.includes("kilauea")) return "kilauea";
  if (a.includes("blocknotes") || a.includes("block_notes")) return "blocknotes";
  if (a.includes("root_goals") || a.includes("rootgoals")) return "root_goals";
  if (a.includes("root_farms") || a.includes("rootfarms")) return "root_farms";
  if (a.includes("visiting_hawaii") || a.includes("visitinghawaii")) return "visiting_hawaii";
  if (a.includes("solana")) return "solana";
  if (a.includes("business_manager")) return "bm";
  if (a.includes("token_manager")) return "token_manager";
  if (a.includes("account_hub")) return "account_hub";
  if (a.includes("weather")) return "weather";
  return "weather";
}

/**
 * GET /api/mobile/developer-messages?app_id=… — returns only the single most recent message.
 *
 * Product apps render only the current/last team update on the developer-messages page,
 * so there's no value shipping a list. Response shape stays `{ messages: [row] | [] }`
 * so older clients that iterate over an array keep working — they'll just see one item.
 */
export async function handleDeveloperMessagesGet(env: DeveloperMessagesEnv, url: URL): Promise<Response> {
  const appId = (url.searchParams.get("app_id") || "").trim();
  try {
    if (!appId) {
      const row = await env.DB.prepare(
        `SELECT id, title, body, app_scope AS app_scope, created_at FROM developer_messages
         WHERE app_scope = 'all' ORDER BY datetime(created_at) DESC LIMIT 1`
      ).first<{ id: string; title: string; body: string; app_scope: string; created_at: string }>();
      return json({ messages: row ? [row] : [] }, 200);
    }
    const scope = scopeForAppId(appId);
    const row = await env.DB.prepare(
      `SELECT id, title, body, app_scope AS app_scope, created_at
       FROM developer_messages
       WHERE app_scope = 'all' OR app_scope = ?
       ORDER BY datetime(created_at) DESC
       LIMIT 1`
    )
      .bind(scope)
      .first<{ id: string; title: string; body: string; app_scope: string; created_at: string }>();
    return json({ messages: row ? [row] : [] }, 200);
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
  const allowed = new Set<string>(["all", ...DEVELOPER_MESSAGE_SCOPES]);
  const app_scope = allowed.has(rawScope) ? rawScope : "all";
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
