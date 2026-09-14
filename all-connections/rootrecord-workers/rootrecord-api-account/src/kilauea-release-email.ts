import type { D1Database } from "@cloudflare/workers-types";

import {
  fetchZohoAccessToken,
  sendTransactionalEmail,
  sendZohoTransactionalEmail,
  type TransactionalEmailEnv,
} from "../../shared/send-transactional-email";
import { isSendableWelcomeEmail } from "./welcome-email";

/** Bump when copy changes; never re-send the same campaign_id to the same email. */
export const KILAUEA_V1044_CAMPAIGN = "kilauea_android_1.0.44";
const KILAUEA_ANDROID_APP_ID = "rootrecord_kilauea_alerts_android";

export const KILAUEA_V1044_SUBJECT = "Kīlauea Alerts 1.0.44 — update on Google Play";

const PLAY_KILAUEA =
  "https://play.google.com/store/apps/details?id=com.rootrecord.kilauea";
const PLAY_WEATHER =
  "https://play.google.com/store/apps/details?id=com.rootrecord.weathermanager";
const WEB_KILAUEA = "https://kilauea.cloud";
const SITE = "https://rootrecord.cloud";
const DISCORD = "https://discord.gg/uQ7kGFqtbG";
const SUPPORT = "root@rootrecord.info";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Signed-in Kīlauea Android users (push token, session, or earn footprint). Guests excluded (no email). */
const AUDIENCE_SQL = `
  SELECT DISTINCT LOWER(TRIM(SUBSTR(src.user_id, 6))) AS email
  FROM (
    SELECT user_id FROM rrwm_push_tokens WHERE app_id = ? AND user_id LIKE 'user:%'
    UNION
    SELECT user_id FROM rr_app_session_last_open WHERE app_id = ? AND user_id LIKE 'user:%'
    UNION
    SELECT user_id FROM rr_earn_app_first_open WHERE app_id = ? AND user_id LIKE 'user:%'
    UNION
    SELECT user_id FROM rr_earn_app_total WHERE app_id = ? AND user_id LIKE 'user:%'
  ) AS src
  WHERE LOWER(TRIM(SUBSTR(src.user_id, 6))) NOT IN (
    SELECT email FROM rr_product_email_campaign_sent WHERE campaign_id = ?
  )
  ORDER BY email ASC
  LIMIT ?
`;

export function kilaueaV1044EmailHtml(email: string): string {
  const safeEmail = escapeHtml(String(email || "").trim());
  return [
    "<p>Kīlauea Alerts <strong>1.0.44</strong> is on Google Play ",
    `(<code>com.rootrecord.kilauea</code>, version code 44). `,
    `<a href="${PLAY_KILAUEA}">Update on Google Play</a></p>`,
    "<p>Built for active eruptive periods: background USGS pushes, fewer duplicate alerts when you open the app, and clearer urgent-notification controls.</p>",
    "<h2 style=\"font-size:1.1em;margin:1.25em 0 0.5em;\">What's new</h2>",
    "<p><strong>Background volcano alerts</strong></p><ul>",
    "<li>Server checks USGS every 10 minutes and sends FCM when a new Kīlauea notice posts</li>",
    "<li>Alerts can arrive with the app closed — not only when you open it</li>",
    "<li>WorkManager still polls on a schedule, at boot, and when you return to the app (backup path)</li>",
    "</ul>",
    "<p><strong>Alert timing fixes</strong></p><ul>",
    "<li>No extra tray notifications while you're already in the app (UI still refreshes)</li>",
    "<li>Notice IDs now match server/FCM so the same USGS notice won't ping twice after you open the app</li>",
    "<li>Push marks notices as seen so open-app doesn't re-fire them</li>",
    "</ul>",
    "<p><strong>Situation briefing</strong></p><ul>",
    "<li>New Situation page — server-managed major-event briefing</li>",
    "<li>Home banner when an event is active (dismissible until the next update)</li>",
    "</ul>",
    "<p><strong>Volcano notification controls (More tab)</strong></p><ul>",
    "<li>Break Do Not Disturb / Bedtime (urgent channel)</li>",
    "<li>Alarm-style sound for orange/red or eruptive notices</li>",
    "<li>Only orange/red or eruptive — filters routine updates</li>",
    "<li>Shortcut to Android urgent channel settings</li>",
    "</ul>",
    "<p>USGS volcano alerts stay <strong>free</strong>. NWS + earthquake pushes remain <strong>Pro</strong>.</p>",
    "<p><strong>Other</strong></p><ul>",
    "<li>Fresher volcano status on Home (~2 min cache)</li>",
    "<li>AI Analysis screen for members (latest + previous summaries)</li>",
    "<li>Password manager autofill on sign-in fields</li>",
    "<li>FCM re-registers after you sign in</li>",
    "<li>Live Feeds / Lava Watchers stream updates on the API side</li>",
    "</ul>",
    "<h2 style=\"font-size:1.1em;margin:1.25em 0 0.5em;\">After you update</h2><ul>",
    "<li><strong>More</strong> → turn on USGS volcano notifications (grant permission on Android 13+ if asked)</li>",
    "<li>For overnight alerts: review DND bypass + alarm sound, then check the urgent channel in system settings</li>",
    "<li>Sign in with your Root Record email if you're Pro</li>",
    "</ul>",
    "<p><strong>Web companion</strong> (same release window): ",
    `<a href="${WEB_KILAUEA}">kilauea.rootrecord.info</a> — dashboard charts, AI reports, auth/autofill tweaks.</p>`,
    "<p>Mahalo to everyone who sent feedback on notification timing and login — that shaped this build.</p>",
    "<hr style=\"border:none;border-top:1px solid #ccc;margin:1.5em 0;\" />",
    "<p><strong>Root Record Software Solutions</strong><br />",
    "16-586 Old Volcano Rd Ste 100-3171<br />",
    "Keaau, HI 96749-8115<br />",
    "United States</p>",
    "<p><strong>Alexander Storey</strong><br />Lead Developer</p>",
    "<p>",
    `<a href="mailto:${SUPPORT}">Email</a> · `,
    `<a href="${SITE}">Website</a> · `,
    `<a href="${DISCORD}">Discord</a>`,
    "</p>",
    "<p>",
    `<a href="${PLAY_WEATHER}">Download the Simple 'Weather' App for Android</a><br />`,
    `<a href="${PLAY_KILAUEA}">Download the 'Kīlauea Alerts' App for Android</a>`,
    "</p>",
    "<p style=\"font-size:0.9em;color:#555;\">",
    `You received this because you use Kīlauea Alerts on Android (${safeEmail}). `,
    `<a href="${SITE}/my-apps.html">Email preferences</a> · `,
    `<a href="mailto:${SUPPORT}?subject=Unsubscribe%20Kilauea%20updates">Contact us to opt out</a>`,
    "</p>",
    "<p>- RootRecord Team</p>",
  ].join("");
}

async function markCampaignSent(
  db: D1Database,
  campaignId: string,
  email: string,
): Promise<void> {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO rr_product_email_campaign_sent (campaign_id, email, sent_at)
       VALUES (?, ?, ?)
       ON CONFLICT(campaign_id, email) DO UPDATE SET sent_at = excluded.sent_at`,
    )
    .bind(campaignId, e, now)
    .run();
}

export type KilaueaReleaseBackfillResult = {
  ok: boolean;
  campaign_id: string;
  dry_run: boolean;
  total_pending: number;
  sent: number;
  failed: number;
  skipped: number;
  sample_recipients: string[];
  errors: string[];
};

export async function runKilaueaV1044ReleaseBackfill(
  env: TransactionalEmailEnv & { DB: D1Database },
  opts?: { dry_run?: boolean; limit?: number; delay_ms?: number; campaign_id?: string },
): Promise<KilaueaReleaseBackfillResult> {
  const campaign_id = String(opts?.campaign_id || KILAUEA_V1044_CAMPAIGN).trim() || KILAUEA_V1044_CAMPAIGN;
  const dry_run = Boolean(opts?.dry_run);
  const limit = Math.min(500, Math.max(1, Math.floor(Number(opts?.limit) || 40)));
  const delay_ms = Math.min(120_000, Math.max(0, Math.floor(Number(opts?.delay_ms) || 12_000)));

  const { results } = await env.DB.prepare(AUDIENCE_SQL)
    .bind(
      KILAUEA_ANDROID_APP_ID,
      KILAUEA_ANDROID_APP_ID,
      KILAUEA_ANDROID_APP_ID,
      KILAUEA_ANDROID_APP_ID,
      campaign_id,
      limit,
    )
    .all<{ email: string }>();

  const rows = results || [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const errors: string[] = [];
  const sample_recipients: string[] = [];

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
    const email = String(row.email || "").trim().toLowerCase();
    if (!isSendableWelcomeEmail(email)) {
      skipped += 1;
      continue;
    }
    if (sample_recipients.length < 8) sample_recipients.push(email);
    if (dry_run) {
      sent += 1;
      continue;
    }
    try {
      const html = kilaueaV1044EmailHtml(email);
      let ok = false;
      if (zohoToken) {
        ok = await sendZohoTransactionalEmail(env, zohoToken, email, KILAUEA_V1044_SUBJECT, html);
      } else {
        ok = await sendTransactionalEmail(env, email, KILAUEA_V1044_SUBJECT, html);
      }
      if (ok) {
        await markCampaignSent(env.DB, campaign_id, email);
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
    campaign_id,
    dry_run,
    total_pending: rows.length,
    sent,
    failed,
    skipped,
    sample_recipients,
    errors,
  };
}

export async function handleKilaueaV1044ReleaseBackfillRoute(
  request: Request,
  env: TransactionalEmailEnv & { DB: D1Database },
): Promise<Response> {
  let body: { dry_run?: boolean; limit?: number; delay_ms?: number; campaign_id?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const url = new URL(request.url);
  const dry_run = body.dry_run === true || url.searchParams.get("dry_run") === "1";
  const limit = body.limit ?? Number(url.searchParams.get("limit") || "40");
  const delay_ms = body.delay_ms ?? Number(url.searchParams.get("delay_ms") || "12000");
  const result = await runKilaueaV1044ReleaseBackfill(env, { dry_run, limit, delay_ms, campaign_id: body.campaign_id });
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
