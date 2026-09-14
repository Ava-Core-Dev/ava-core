/**
 * Read-only: fetch guild channels + roles and write JSON (for wrangler / ops reference).
 *
 * Each channel includes `permission_overwrites` (Discord: id, type, allow, deny) from
 * GET /guilds/{id}/channels — use this snapshot to diff or restore before bulk permission edits.
 *
 * Reads DISCORD_BOT_TOKEN + DISCORD_GUILD_ID from repo-root credentials.env (or env).
 *
 * Usage:
 *   node scripts/discord-guild-inventory.mjs
 *   node scripts/discord-guild-inventory.mjs --out ./discord-guild-snapshot.local.json
 */
import fs from "node:fs";
import path from "node:path";

const API = "https://discord.com/api/v10";

function readEnvFile(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
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

async function discordGet(token, path) {
  const res = await fetch(`${API}${path.startsWith("/") ? path : "/" + path}`, {
    headers: {
      Authorization: `Bot ${token.trim()}`,
      "User-Agent": "RootRecord/discord-guild-inventory",
    },
  });
  const text = await res.text();
  let j = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    j = { _raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const err = new Error(`Discord HTTP ${res.status}: ${text.slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  return j;
}

/** type 0 = role, 1 = member; allow/deny are stringified permission bitfields. */
function slimOverwrite(o, roleNameById) {
  const id = String(o.id ?? "");
  const type = o.type === 1 ? 1 : 0;
  const row = {
    id,
    type,
    allow: String(o.allow ?? "0"),
    deny: String(o.deny ?? "0"),
  };
  if (type === 0 && roleNameById.has(id)) row.role_name = roleNameById.get(id);
  return row;
}

function slimChannel(c, roleNameById) {
  const raw = Array.isArray(c.permission_overwrites) ? c.permission_overwrites : [];
  return {
    id: c.id,
    type: c.type,
    name: c.name ?? null,
    parent_id: c.parent_id ?? null,
    position: c.position ?? null,
    topic: typeof c.topic === "string" ? c.topic.slice(0, 200) : null,
    permission_overwrites: raw.map((o) => slimOverwrite(o, roleNameById)),
  };
}

function slimRole(r) {
  return {
    id: r.id,
    name: r.name,
    position: r.position,
    managed: Boolean(r.managed),
    bot_id: r.tags?.bot_id ?? null,
    integration_id: r.tags?.integration_id ?? null,
  };
}

function findCredentialsPath() {
  if (process.env.CREDENTIALS_ENV && fs.existsSync(process.env.CREDENTIALS_ENV)) return process.env.CREDENTIALS_ENV;
  const here = process.cwd();
  const candidates = [
    path.join(here, "credentials.env"),
    path.join(here, "../../../credentials.env"),
    path.join(here, "../../../../credentials.env"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(here, "../../../credentials.env");
}

const credPath = findCredentialsPath();
const fileEnv = readEnvFile(credPath);
const token = String(process.env.DISCORD_BOT_TOKEN || fileEnv.DISCORD_BOT_TOKEN || "").trim();
const guildId = String(process.env.DISCORD_GUILD_ID || fileEnv.DISCORD_GUILD_ID || "").trim();
const outPath = arg("--out") || path.join(process.cwd(), "discord-guild-snapshot.local.json");

if (!token || !guildId) {
  console.error("Need DISCORD_BOT_TOKEN and DISCORD_GUILD_ID (credentials.env or env).");
  console.error("Credentials file:", credPath, fs.existsSync(credPath) ? "(found)" : "(missing)");
  process.exit(1);
}

const [channels, roles] = await Promise.all([
  discordGet(token, `/guilds/${encodeURIComponent(guildId)}/channels`),
  discordGet(token, `/guilds/${encodeURIComponent(guildId)}/roles`),
]);

const roleNameById = new Map(
  Array.isArray(roles)
    ? roles
        .filter((r) => r && r.id != null)
        .map((r) => [String(r.id), String(r.name != null ? r.name : "")])
    : [],
);

const snapshot = {
  guild_id: guildId,
  fetched_at: new Date().toISOString(),
  channels: Array.isArray(channels) ? channels.map((c) => slimChannel(c, roleNameById)) : [],
  roles: Array.isArray(roles) ? roles.sort((a, b) => (b.position || 0) - (a.position || 0)).map(slimRole) : [],
};

fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
const owCount = snapshot.channels.reduce((n, c) => n + (Array.isArray(c.permission_overwrites) ? c.permission_overwrites.length : 0), 0);
console.log("Wrote", outPath, "channels=", snapshot.channels.length, "roles=", snapshot.roles.length, "overwrites=", owCount);
