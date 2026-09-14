/**
 * Post a verification message to a Discord channel.
 *
 * Reads DISCORD_BOT_TOKEN from repo-root credentials.env.
 *
 * Usage:
 *   node scripts/discord-post-verify-message.mjs --channel <channelId>
 *   node scripts/discord-post-verify-message.mjs --channel <channelId> --invite https://discord.gg/...
 */
import fs from "node:fs";

function readEnvFile(p) {
  const out = {};
  const text = fs.readFileSync(p, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function arg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] || "").trim();
}

const channelId = arg("--channel");
if (!channelId) {
  console.error("Usage: node scripts/discord-post-verify-message.mjs --channel <channelId> [--invite <url>]");
  process.exit(1);
}

const invite = arg("--invite") || "https://discord.gg/CPaDYuFkU";
const credPath =
  process.env.CREDENTIALS_ENV ||
  "C:/Users/rootr/ava/credentials.env";
const env = readEnvFile(credPath);
const token = String(env.DISCORD_BOT_TOKEN || "").trim();
if (!token) {
  console.error("Missing DISCORD_BOT_TOKEN in credentials.env");
  process.exit(1);
}

const msg =
  "**Verify your RootRecord account**\n\n" +
  "To chat in this server, link your Discord to your RootRecord portal account:\n\n" +
  "1) Create / sign in to your account: https://rootrecord.cloud/account.html\n" +
  "2) Click **Link Discord** and authorize — or open https://rootrecord.cloud/discord-verify\n" +
  "3) You will automatically receive **@Verified** and can message.\n\n" +
  "Need an account? https://rootrecord.cloud/account-signup.html\n\n" +
  `Invite link: ${invite}\n`;

const res = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
  method: "POST",
  headers: {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "RootRecordAccountWorker (verify message poster)",
  },
  body: JSON.stringify({ content: msg }),
});

const text = await res.text().catch(() => "");
if (!res.ok) {
  console.error("Discord HTTP", res.status, text.slice(0, 400));
  process.exit(1);
}
console.log("ok", res.status, text.slice(0, 120));

