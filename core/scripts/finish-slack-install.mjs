/**
 * After Ava Slack app exists: print install URL; optionally exchange code.
 * Usage: node scripts/finish-slack-install.mjs [oauth_code]
 */
import fs from "node:fs";
import { loadEnv } from "../src/config.mjs";

const ROOT_ENV = "E:\\.1 Work Stations\\RootMC\\.env";
const HAND_OFF =
  "E:\\.Ava_Ivy\\data\\slack-app.json";

function upsertEnv(key, value) {
  if (!value) return;
  let c = fs.readFileSync(ROOT_ENV, "utf8");
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(c)) c = c.replace(re, `${key}=${value}`);
  else c = `${c.trimEnd()}\n${key}=${value}\n`;
  fs.writeFileSync(ROOT_ENV, c);
}

const env = await loadEnv();
const meta = JSON.parse(fs.readFileSync(HAND_OFF, "utf8"));
const code = process.argv[2] || "";

console.log("app_id=", meta.app_id);
console.log("INSTALL:", meta.oauth_authorize_url);

if (!code) {
  console.log(
    "\n1) Open INSTALL URL → Allow\n2) If redirect fails, from api.slack.com/apps → Ava Ivy → OAuth & Permissions copy Bot Token\n3) Basic Information → App-Level Tokens → generate connections:write → copy xapp\n4) Paste both here or set AVA_SLACK_BOT_TOKEN / AVA_SLACK_APP_TOKEN in .env",
  );
  process.exit(0);
}

const clientId = String(
  process.env.AVA_SLACK_CLIENT_ID || env.AVA_SLACK_CLIENT_ID || "",
).trim();
const clientSecret = String(
  process.env.AVA_SLACK_CLIENT_SECRET || env.AVA_SLACK_CLIENT_SECRET || "",
).trim();

// Accept raw code or full redirect URL: https://localhost/?code=...
let raw = String(code).trim();
if (/^https?:\/\//i.test(raw) || raw.includes("code=")) {
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    raw = u.searchParams.get("code") || raw;
  } catch {
    const m = raw.match(/[?&]code=([^&]+)/);
    if (m) raw = decodeURIComponent(m[1]);
  }
}

const body = new URLSearchParams({
  code: raw,
  client_id: clientId,
  client_secret: clientSecret,
  redirect_uri: "https://localhost",
});
const res = await fetch("https://slack.com/api/oauth.v2.access", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body,
});
const data = await res.json();
if (!data.ok) {
  console.error("oauth exchange failed:", data.error);
  process.exit(1);
}
const scopes = (data.scope || "").split(",").filter(Boolean);
upsertEnv("AVA_SLACK_BOT_TOKEN", data.access_token);
upsertEnv("AVA_SLACK_BOT_USER_ID", data.bot_user_id || "");
console.log("bot token stored · bot_user_id=", data.bot_user_id || "(none)");
console.log("scopes:", scopes.join(", ") || "(none)");
console.log("Still need AVA_SLACK_APP_TOKEN (xapp) from App-Level Tokens UI");