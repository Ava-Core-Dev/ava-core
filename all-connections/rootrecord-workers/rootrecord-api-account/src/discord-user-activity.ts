import type { D1Database } from "@cloudflare/workers-types";
import { json } from "./cors";
import { verifyWorkerOpsAdmin } from "./push";

export type DiscordUserActivityEnv = {
  DB: D1Database;
  RR_PUSH_ADMIN_SECRET?: string;
};

const NO_STORE = { "Cache-Control": "no-store, max-age=0, must-revalidate" } as const;

/** GET /api/internal/discord-user-activity — newest posters first (`X-RR-Push-Admin-Key`). */
export async function handleDiscordUserActivityGet(request: Request, env: DiscordUserActivityEnv): Promise<Response> {
  const secret = (env.RR_PUSH_ADMIN_SECRET || "").trim();
  if (!secret) return json({ detail: "RR_PUSH_ADMIN_SECRET is not set on this Worker." }, 503, NO_STORE);
  if (!(await verifyWorkerOpsAdmin(request, env))) {
    const has = Boolean(request.headers.get("X-RR-Push-Admin-Key"));
    return json({ detail: has ? "Invalid admin key." : "Missing X-RR-Push-Admin-Key header." }, 401, NO_STORE);
  }

  let limit = 100;
  const raw = new URL(request.url).searchParams.get("limit");
  if (raw != null) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) limit = Math.min(500, Math.max(1, n));
  }

  const q = await env.DB.prepare(
    `SELECT discord_user_id, username, global_name, last_message_at, last_message_id, message_count, updated_at
     FROM discord_user_activity
     ORDER BY last_message_at DESC
     LIMIT ?`
  )
    .bind(limit)
    .all();

  return json({ ok: true, rows: q.results ?? [] }, 200, NO_STORE);
}
