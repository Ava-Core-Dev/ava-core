import type { D1Database } from "@cloudflare/workers-types";

import {
  fetchZohoAccessToken,
  sendTransactionalEmail,
  sendZohoTransactionalEmail,
  type TransactionalEmailEnv,
} from "../../shared/send-transactional-email";

export const WELCOME_EMAIL_SUBJECT = "Welcome to RootRecord — apps, resources, and your promo code";

function escapeHtmlSimple(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function welcomeEmailHtml(email: string): string {
  const safeEmail = escapeHtmlSimple(String(email || "").trim());
  return [
    "<p>Welcome to RootRecord.</p>",
    "<p>Your account is ready across our web and Android apps.</p>",
    "<p><strong>Apps</strong></p>",
    "<ul>",
    "<li><strong>Business Manager</strong>: operations workspace for time, money, clients, inventory, scheduling, and reports.</li>",
    "<li><strong>Weather Manager</strong>: weather, alerts, earthquakes, and hazard context for your saved locations.</li>",
    "<li><strong>Kīlauea Alerts</strong>: Kīlauea-focused dashboard with seismic activity, weather, USGS notices, and NWS alerts.</li>",
    "</ul>",
    "<p><strong>Resources</strong></p>",
    "<ul>",
    "<li>Products: <a href=\"https://rootrecord.cloud/products.html\">https://rootrecord.cloud/products.html</a></li>",
    "<li>Billing: <a href=\"https://rootrecord.cloud/billing\">https://rootrecord.cloud/billing</a></li>",
    "<li>My Apps: <a href=\"https://rootrecord.cloud/my-apps.html\">https://rootrecord.cloud/my-apps.html</a></li>",
    "<li>FAQ: <a href=\"https://rootrecord.cloud/faq.html\">https://rootrecord.cloud/faq.html</a></li>",
    "<li>Discord community: <a href=\"https://discord.gg/uQ7kGFqtbG\">https://discord.gg/uQ7kGFqtbG</a></li>",
    "</ul>",
    "<p><strong>Promo code</strong></p>",
    "<p>Use code <strong>JUNE26</strong> at checkout:</p>",
    "<p><a href=\"https://rootrecord.cloud/billing\">https://rootrecord.cloud/billing</a></p>",
    "<p>Signed in as: " + safeEmail + "</p>",
    "<p>- RootRecord Team</p>",
  ].join("");
}

const SKIP_EMAIL_RE = /@example\.com$/i;

export function isSendableWelcomeEmail(email: string): boolean {
  const e = String(email || "").trim().toLowerCase();
  if (!e || !e.includes("@") || e.length > 254) return false;
  if (SKIP_EMAIL_RE.test(e)) return false;
  return true;
}

export async function markFirstTimeEmailSent(db: D1Database, accountId: string): Promise<void> {
  const id = String(accountId || "").trim();
  if (!id) return;
  const now = new Date().toISOString();
  await db
    .prepare(`UPDATE user_accounts SET first_time_email_sent = 1, updated_at = ? WHERE id = ?`)
    .bind(now, id)
    .run();
}

export async function sendWelcomeEmail(
  env: TransactionalEmailEnv & { DB: D1Database },
  accountId: string,
  email: string,
): Promise<boolean> {
  const id = String(accountId || "").trim();
  const to = String(email || "").trim().toLowerCase();
  if (!id || !isSendableWelcomeEmail(to)) return false;

  const row = await env.DB.prepare(`SELECT first_time_email_sent FROM user_accounts WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<{ first_time_email_sent: number }>()
    .catch(() => null);
  if (row && Number(row.first_time_email_sent) === 1) return false;

  const sent = await sendTransactionalEmail(env, to, WELCOME_EMAIL_SUBJECT, welcomeEmailHtml(to));
  if (sent) await markFirstTimeEmailSent(env.DB, id);
  return sent;
}

export type FirstTimeWelcomeBackfillResult = {
  ok: boolean;
  dry_run: boolean;
  total_pending: number;
  sent: number;
  failed: number;
  skipped: number;
  errors: string[];
};

export async function runFirstTimeWelcomeBackfill(
  env: TransactionalEmailEnv & { DB: D1Database },
  opts?: { dry_run?: boolean; limit?: number; delay_ms?: number },
): Promise<FirstTimeWelcomeBackfillResult> {
  const dry_run = Boolean(opts?.dry_run);
  const limit = Math.min(500, Math.max(1, Math.floor(Number(opts?.limit) || 500)));
  const delay_ms = Math.min(5000, Math.max(0, Math.floor(Number(opts?.delay_ms) || 2500)));

  const { results } = await env.DB.prepare(
    `SELECT id, email FROM user_accounts
     WHERE COALESCE(first_time_email_sent, 0) = 0
     ORDER BY created_at ASC
     LIMIT ?`,
  )
    .bind(limit)
    .all<{ id: string; email: string }>();

  const rows = results || [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const errors: string[] = [];

  let zohoToken: string | null = null;
  if (!dry_run) {
    try {
      zohoToken = await fetchZohoAccessToken(env);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (errors.length < 30) errors.push(`Zoho OAuth: ${msg}`);
    }
  }

  for (const row of rows) {
    const id = String(row.id || "").trim();
    const email = String(row.email || "").trim().toLowerCase();
    if (!id || !isSendableWelcomeEmail(email)) {
      skipped += 1;
      continue;
    }
    if (dry_run) {
      sent += 1;
      continue;
    }
    try {
      let ok = false;
      if (zohoToken) {
        ok = await sendZohoTransactionalEmail(env, zohoToken, email, WELCOME_EMAIL_SUBJECT, welcomeEmailHtml(email));
        if (ok) await markFirstTimeEmailSent(env.DB, id);
      } else {
        ok = await sendWelcomeEmail(env, id, email);
      }
      if (ok) {
        sent += 1;
      } else {
        failed += 1;
        if (errors.length < 30) errors.push(`${email}: send returned false`);
      }
    } catch (e) {
      failed += 1;
      if (errors.length < 30) errors.push(`${email}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (delay_ms > 0) await new Promise((r) => setTimeout(r, delay_ms));
  }

  return {
    ok: failed === 0 || sent > 0,
    dry_run,
    total_pending: rows.length,
    sent,
    failed,
    skipped,
    errors,
  };
}

export async function handleFirstTimeWelcomeBackfillRoute(
  request: Request,
  env: TransactionalEmailEnv & { DB: D1Database },
): Promise<Response> {
  let body: { dry_run?: boolean; limit?: number; delay_ms?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const url = new URL(request.url);
  const dry_run = body.dry_run === true || url.searchParams.get("dry_run") === "1";
  const limit = body.limit ?? Number(url.searchParams.get("limit") || "500");
  const delay_ms = body.delay_ms ?? Number(url.searchParams.get("delay_ms") || "2500");
  const result = await runFirstTimeWelcomeBackfill(env, { dry_run, limit, delay_ms });
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
