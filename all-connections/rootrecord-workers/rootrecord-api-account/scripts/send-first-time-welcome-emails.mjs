/**
 * One-time welcome email to all user_accounts with first_time_email_sent = 0.
 *
 * Prereqs: migration 0070; Worker deployed; Zoho secrets on Worker (scripts/zoho-mail-setup-once.ps1 once).
 *
 *   node scripts/send-first-time-welcome-emails.mjs              # dry-run
 *   node scripts/send-first-time-welcome-emails.mjs --execute    # send + set D1 flag
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const API_BASE = (
  process.env.ROOTRECORD_API_ACCOUNT_BASE || "https://api.rootrecord.online"
).replace(/\/$/, "");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (!(k in process.env) || !String(process.env[k]).trim()) process.env[k] = v;
  }
}

function loadCredentials() {
  let probe = root;
  for (let i = 0; i < 16; i++) {
    loadEnvFile(join(probe, "credentials.env"));
    loadEnvFile(join(probe, "Web", "credentials.env"));
    const parent = dirname(probe);
    if (!parent || parent === probe) break;
    probe = parent;
  }
}

loadCredentials();

const execute = process.argv.includes("--execute");
const adminKey = String(process.env.RR_PUSH_ADMIN_SECRET || "").trim();
if (!adminKey) {
  console.error("Missing RR_PUSH_ADMIN_SECRET in credentials.env");
  process.exit(1);
}

const body = {
  dry_run: !execute,
  limit: Number(process.env.WELCOME_EMAIL_LIMIT || "500"),
  delay_ms: Number(process.env.WELCOME_EMAIL_DELAY_MS || "2500"),
};

const res = await fetch(`${API_BASE}/api/internal/send-first-time-welcome-emails`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-RR-Push-Admin-Key": adminKey,
  },
  body: JSON.stringify(body),
});

const text = await res.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  console.error(res.status, text.slice(0, 500));
  process.exit(1);
}

if (!res.ok) {
  console.error(res.status, data);
  process.exit(1);
}

console.log(JSON.stringify(data, null, 2));
if (!execute) {
  console.log("\nDry run only. Re-run with --execute to send and set first_time_email_sent = 1.");
}
