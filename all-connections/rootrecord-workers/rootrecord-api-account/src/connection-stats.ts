import type { D1Database } from "@cloudflare/workers-types";
import { json } from "./cors";
import { verifyWorkerOpsAdmin } from "./push";

const ACTIVE_SESSION_MINUTES = 30;

/** Same classification as Ava connectionsTelemetry — browser vs native/app clients. */
export function classifySessionAgent(ua: unknown): "web" | "app" {
  const s = String(ua || "");
  if (!s) return "app";
  const lower = s.toLowerCase();
  const isApp =
    /\bwv\b/.test(lower) ||
    lower.includes("okhttp") ||
    lower.includes("dart:") ||
    lower.includes("capacitor") ||
    lower.includes("cordova") ||
    lower.includes("rootmc") ||
    lower.includes("kilauea") ||
    lower.includes("reactnative") ||
    lower.includes("expo");
  if (isApp) return "app";
  if (lower.includes("mozilla/") || lower.includes("chrome/") || lower.includes("safari/")) {
    return "web";
  }
  return "app";
}

/**
 * GET `/api/internal/connection-stats`
 * Active license sessions split into web vs app (ops admin key).
 */
export async function handleInternalConnectionStats(
  request: Request,
  env: { DB: D1Database; RR_PUSH_ADMIN_SECRET?: string },
): Promise<Response> {
  const secret = String(env.RR_PUSH_ADMIN_SECRET || "").trim();
  if (!secret) {
    return json({ detail: "RR_PUSH_ADMIN_SECRET is not set on this Worker." }, 503);
  }
  const adminOk = await verifyWorkerOpsAdmin(request, env);
  if (!adminOk) {
    const has = Boolean(request.headers.get("X-RR-Push-Admin-Key"));
    return json({ detail: has ? "Invalid admin key." : "Missing X-RR-Push-Admin-Key header." }, 401);
  }

  const cutoffIso = new Date(Date.now() - ACTIVE_SESSION_MINUTES * 60_000).toISOString();
  const rows = await env.DB.prepare(
    `SELECT user_agent, account_id
     FROM license_sessions
     WHERE revoked_at IS NULL
       AND last_seen_at IS NOT NULL
       AND last_seen_at >= ?`,
  )
    .bind(cutoffIso)
    .all<{ user_agent: string | null; account_id: string | null }>();

  let web = 0;
  let apps = 0;
  const webAccounts = new Set<string>();
  const appAccounts = new Set<string>();
  for (const r of rows.results || []) {
    const kind = classifySessionAgent(r.user_agent);
    if (kind === "web") {
      web += 1;
      if (r.account_id) webAccounts.add(r.account_id);
    } else {
      apps += 1;
      if (r.account_id) appAccounts.add(r.account_id);
    }
  }

  return json(
    {
      ok: true,
      window_minutes: ACTIVE_SESSION_MINUTES,
      web_sessions: web,
      app_sessions: apps,
      total_sessions: web + apps,
      web_accounts: webAccounts.size,
      app_accounts: appAccounts.size,
      active_sessions: web + apps,
    },
    200,
  );
}
