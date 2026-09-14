/**
 * Create Ava Ivy Slack app via configuration token + manifest.
 * Does not print secret token values.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../src/config.mjs";

const ROOT_ENV = "E:\\.1 Work Stations\\RootMC\\.env";
const HAND_OFF =
  "E:\\.Ava_Ivy\\data\\slack-app.json";
const MANIFEST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../slack-app-manifest.json",
);

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
let refresh = String(
  process.env.AVA_SLACK_CONFIG_REFRESH || env.AVA_SLACK_CONFIG_REFRESH || "",
).trim();

if (!token && !refresh) {
  console.error("missing AVA_SLACK_CONFIG_TOKEN / AVA_SLACK_CONFIG_REFRESH");
  process.exit(1);
}

if (refresh) {
  const body = new URLSearchParams({ refresh_token: refresh });
  const res = await fetch("https://slack.com/api/tooling.tokens.rotate", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (data.ok) {
    token = data.token;
    refresh = data.refresh_token;
    upsertEnv("AVA_SLACK_CONFIG_TOKEN", token);
    upsertEnv("AVA_SLACK_CONFIG_REFRESH", refresh);
    console.log("rotated config token · exp=", data.exp);
  } else {
    console.warn("rotate:", data.error, "— using access token as-is");
  }
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const form = new URLSearchParams();
form.set("manifest", JSON.stringify(manifest));
const createRes = await fetch("https://slack.com/api/apps.manifest.create", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: form,
});
const created = await createRes.json();
if (!created.ok) {
  console.error(
    "create failed:",
    created.error,
    JSON.stringify(created.errors || created).slice(0, 2000),
  );
  process.exit(1);
}

const creds = created.credentials || {};
upsertEnv("AVA_SLACK_APP_ID", created.app_id);
upsertEnv("AVA_SLACK_CLIENT_ID", creds.client_id);
upsertEnv("AVA_SLACK_CLIENT_SECRET", creds.client_secret);
upsertEnv("AVA_SLACK_SIGNING_SECRET", creds.signing_secret);

fs.writeFileSync(
  HAND_OFF,
  JSON.stringify(
    {
      app_id: created.app_id,
      client_id: creds.client_id || null,
      oauth_authorize_url: created.oauth_authorize_url || null,
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

console.log("app_id=", created.app_id);
console.log("oauth_authorize_url=", created.oauth_authorize_url);
console.log("client credentials stored in .env (not printed)");
