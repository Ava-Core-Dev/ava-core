/**
 * Local Zoho send for users still at first_time_email_sent = 0.
 *
 * Requires in credentials.env (repo root):
 *   ZOHO_MAIL_CLIENT_ID, ZOHO_MAIL_CLIENT_SECRET, ZOHO_MAIL_REFRESH_TOKEN
 *   ZOHO_MAIL_ACCOUNT_ID, ZOHO_MAIL_FROM
 *
 *   node scripts/send-first-time-welcome-emails-local.mjs
 *   node scripts/send-first-time-welcome-emails-local.mjs --execute
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const execute = process.argv.includes("--execute");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (!(k in process.env) || !String(process.env[k]).trim()) process.env[k] = v;
  }
}

let probe = root;
for (let i = 0; i < 16; i++) {
  loadEnvFile(join(probe, "credentials.env"));
  loadEnvFile(join(probe, "Web", "credentials.env"));
  const parent = dirname(probe);
  if (!parent || parent === probe) break;
  probe = parent;
}

const clientId = String(process.env.ZOHO_MAIL_CLIENT_ID || "").trim();
const clientSecret = String(process.env.ZOHO_MAIL_CLIENT_SECRET || "").trim();
const refreshToken = String(process.env.ZOHO_MAIL_REFRESH_TOKEN || "").trim();
const accountId = String(process.env.ZOHO_MAIL_ACCOUNT_ID || "").trim();
const from = String(process.env.ZOHO_MAIL_FROM || "RootRecord <root@rootrecord.info>").trim();
const accountsBase = String(process.env.ZOHO_ACCOUNTS_BASE_URL || "https://accounts.zoho.com").replace(/\/$/, "");
const mailBase = String(process.env.ZOHO_MAIL_API_BASE_URL || "https://mail.zoho.com").replace(/\/$/, "");

if (!clientId || !clientSecret || !refreshToken || !accountId) {
  console.error("Missing ZOHO_MAIL_* in credentials.env. See scripts/zoho-mail-setup-once.ps1");
  process.exit(1);
}

const SUBJECT = "Welcome to RootRecord — apps, resources, and your promo code";

function welcomeHtml(email) {
  const safe = String(email)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return [
    "<p>Welcome to RootRecord.</p>",
    "<p>Your account is ready across our web and Android apps.</p>",
    "<p><strong>Apps</strong></p><ul>",
    "<li><strong>Business Manager</strong>: operations workspace for time, money, clients, inventory, scheduling, and reports.</li>",
    "<li><strong>Weather Manager</strong>: weather, alerts, earthquakes, and hazard context for your saved locations.</li>",
    "<li><strong>Kīlauea Alerts</strong>: Kīlauea-focused dashboard with seismic activity, weather, USGS notices, and NWS alerts.</li>",
    "</ul>",
    "<p><strong>Resources</strong></p><ul>",
    '<li>Products: <a href="https://rootrecord.online/products.html">https://rootrecord.online/products.html</a></li>',
    '<li>Billing: <a href="https://rootrecord.online/billing">https://rootrecord.online/billing</a></li>',
    '<li>My Apps: <a href="https://rootrecord.online/my-apps.html">https://rootrecord.online/my-apps.html</a></li>',
    '<li>FAQ: <a href="https://rootrecord.online/faq.html">https://rootrecord.online/faq.html</a></li>',
    '<li>Discord: <a href="https://discord.gg/uQ7kGFqtbG">https://discord.gg/uQ7kGFqtbG</a></li>',
    "</ul>",
    "<p><strong>Promo code</strong></p>",
    "<p>Use code <strong>JUNE26</strong> at checkout: <a href=\"https://rootrecord.online/billing\">https://rootrecord.online/billing</a></p>",
    `<p>Signed in as: ${safe}</p><p>- RootRecord Team</p>`,
  ].join("");
}

async function zohoAccessToken() {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch(`${accountsBase}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Zoho token: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return String(data.access_token);
}

async function zohoSend(access, to, html) {
  const res = await fetch(`${mailBase}/api/accounts/${accountId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${access}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fromAddress: from.includes("<") ? from.match(/<([^>]+)>/)?.[1] || from : from,
      toAddress: to,
      subject: SUBJECT,
      content: html,
      mailFormat: "html",
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Zoho send ${res.status}: ${t.slice(0, 200)}`);
  }
}

function d1Json(sql) {
  const out = execSync(`npx wrangler d1 execute root-record --remote --json --command ${JSON.stringify(sql)}`, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const parsed = JSON.parse(out);
  return parsed?.[0]?.results || [];
}

const rows = d1Json(
  `SELECT id, email FROM user_accounts WHERE COALESCE(first_time_email_sent, 0) = 0 ORDER BY created_at ASC LIMIT 500`,
);
const pending = rows.filter((r) => {
  const e = String(r.email || "").trim().toLowerCase();
  return e.includes("@") && !e.endsWith("@example.com");
});

console.log(`Pending: ${pending.length} (execute=${execute})`);
if (!execute) {
  console.log(pending.slice(0, 10).map((r) => r.email));
  console.log("\nRe-run with --execute");
  process.exit(0);
}

const access = await zohoAccessToken();
let sent = 0;
let failed = 0;
const errors = [];

for (const row of pending) {
  const id = String(row.id);
  const email = String(row.email).trim().toLowerCase();
  try {
    await zohoSend(access, email, welcomeHtml(email));
    const now = new Date().toISOString();
    d1Json(`UPDATE user_accounts SET first_time_email_sent = 1, updated_at = '${now}' WHERE id = '${id.replace(/'/g, "''")}'`);
    sent += 1;
    await new Promise((r) => setTimeout(r, Number(process.env.WELCOME_EMAIL_DELAY_MS || "2500")));
  } catch (e) {
    failed += 1;
    if (errors.length < 25) errors.push(`${email}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(JSON.stringify({ sent, failed, errors }, null, 2));
