/**
 * Patch Ava Slack app manifest (redirect_urls etc.) via config token.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../src/config.mjs";

const ROOT_ENV = "E:\\.1 Work Stations\\RootMC\\.env";
const MANIFEST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../slack-app-manifest.json",
);
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
let token = String(
  process.env.AVA_SLACK_CONFIG_TOKEN || env.AVA_SLACK_CONFIG_TOKEN || "",
).trim();
const refresh = String(
  process.env.AVA_SLACK_CONFIG_REFRESH || env.AVA_SLACK_CONFIG_REFRESH || "",
).trim();
const appId = String(
  process.env.AVA_SLACK_APP_ID || env.AVA_SLACK_APP_ID || "A0BMAC7NZD3",
).trim();

if (refresh) {
  const rot = await fetch("https://slack.com/api/tooling.tokens.rotate", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refresh }),
  }).then((r) => r.json());
  if (rot.ok) {
    token = rot.token;
    upsertEnv("AVA_SLACK_CONFIG_TOKEN", rot.token);
    upsertEnv("AVA_SLACK_CONFIG_REFRESH", rot.refresh_token);
    console.log("rotated ok");
  } else {
    console.warn("rotate:", rot.error);
  }
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const form = new URLSearchParams();
form.set("app_id", appId);
form.set("manifest", JSON.stringify(manifest));

const updated = await fetch("https://slack.com/api/apps.manifest.update", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: form,
}).then((r) => r.json());

if (!updated.ok) {
  console.error(
    "update failed:",
    updated.error,
    JSON.stringify(updated.errors || updated).slice(0, 1500),
  );
  process.exit(1);
}

const clientId =
  String(process.env.AVA_SLACK_CLIENT_ID || env.AVA_SLACK_CLIENT_ID || "").trim() ||
  "11714094715524.11724415781445";
const scopes = manifest.oauth_config.scopes.bot.join(",");
const installUrl = `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent("https://localhost")}`;
const dashboardInstall = `https://api.slack.com/apps/${appId}/oauth`;

const meta = {
  app_id: appId,
  client_id: clientId,
  oauth_authorize_url: installUrl,
  dashboard_oauth: dashboardInstall,
  updatedAt: new Date().toISOString(),
};
fs.writeFileSync(HAND_OFF, JSON.stringify(meta, null, 2));

console.log("manifest updated · redirect_urls=https://localhost");
console.log("PREFERRED: open dashboard → Install to Workspace:");
console.log(dashboardInstall);
console.log("alt oauth url (redirect https://localhost):");
console.log(installUrl);
