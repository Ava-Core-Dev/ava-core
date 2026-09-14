/**
 * Apply RootMC Discord chat locks: @everyone read-only, MC-linked role can speak.
 *
 * Usage (from Web/cloudflare/rootmc-realm-api/):
 *   node scripts/discord-apply-rootmc-chat-locks.mjs
 *   node scripts/discord-apply-rootmc-chat-locks.mjs --confirm
 *
 * Requires DISCORD_ROOTMC_BOT_TOKEN in RootMC .env or credentials.env.
 */
import fs from "node:fs";
import path from "node:path";
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";

const API = "https://discord.com/api/v10";

const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const READ_HISTORY = 1n << 16n;
const CONNECT = 1n << 20n;
const SPEAK = 1n << 21n;
const ATTACH_FILES = 1n << 15n;
const USE_APP_CMD = 1n << 31n;
const CREATE_PUB_THREAD = 1n << 35n;
const CREATE_PRIV_THREAD = 1n << 36n;
const SEND_IN_THREAD = 1n << 38n;

function perm(...bits) {
  return bits.reduce((a, b) => a | b, 0n).toString();
}

function readWranglerVar(name) {
  const p = path.join(process.cwd(), "wrangler.toml");
  if (!fs.existsSync(p)) return "";
  const m = fs.readFileSync(p, "utf8").match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m"));
  return m ? m[1] : "";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function discordReq(token, method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "RootRecord/rootmc-chat-locks",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${route} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function putOverwrite(token, channelId, targetId, type, allow, deny) {
  await discordReq(token, "PUT", `/channels/${channelId}/permissions/${targetId}`, {
    id: targetId,
    type,
    allow,
    deny,
  });
}

function isTextLike(t) {
  return t === 0 || t === 5 || t === 15 || t === 12;
}
function isVoiceLike(t) {
  return t === 2 || t === 13;
}

function isUnderCategory(ch, categoryId, byId) {
  if (!categoryId) return false;
  let parent = ch.parent_id ? byId.get(String(ch.parent_id)) : undefined;
  while (parent) {
    if (String(parent.id) === categoryId) return true;
    parent = parent.parent_id ? byId.get(String(parent.parent_id)) : undefined;
  }
  return false;
}

function resolvePolicy(ch, cfg, byId) {
  if (ch.type === 4) return "skip";
  for (const cat of cfg.skipCategories) {
    if (isUnderCategory(ch, cat, byId)) return "skip";
  }
  if (cfg.staffChannelIds.has(String(ch.id))) return "staff_only";
  if (String(ch.id) === cfg.rulesChannelId) return "rules_readonly";
  const hay = `${String(ch.name || "").toLowerCase()} ${String(ch.topic || "").toLowerCase()}`;
  if (/\badmin\b|\bmoderators?\b|\bstaff-?only\b|\binternal\b|\baudit\b|\bbot-?spam\b/.test(hay)) {
    return "staff_only";
  }
  return "linked_speak";
}

async function applyPolicy(token, guildId, ch, policy, cfg, botUserId) {
  const id = String(ch.id);
  const linkedText = perm(
    VIEW,
    READ_HISTORY,
    SEND,
    USE_APP_CMD,
    ATTACH_FILES,
    CREATE_PUB_THREAD,
    CREATE_PRIV_THREAD,
    SEND_IN_THREAD,
  );
  const botText = perm(VIEW, READ_HISTORY, SEND);
  const botVoice = perm(VIEW, CONNECT, SPEAK);

  if (policy === "rules_readonly" && isTextLike(ch.type)) {
    await putOverwrite(token, id, guildId, 0, perm(VIEW, READ_HISTORY), perm(SEND, SEND_IN_THREAD, CREATE_PUB_THREAD, CREATE_PRIV_THREAD, ATTACH_FILES));
    if (cfg.staffRoleId) await putOverwrite(token, id, cfg.staffRoleId, 0, linkedText, "0");
    if (botUserId) await putOverwrite(token, id, botUserId, 1, botText, "0");
    return;
  }

  if (policy === "staff_only") {
    const hide = perm(VIEW, SEND, CONNECT, SPEAK);
    await putOverwrite(token, id, guildId, 0, "0", hide);
    if (cfg.staffRoleId) {
      const staffAllow = isVoiceLike(ch.type) ? perm(VIEW, CONNECT, SPEAK, READ_HISTORY) : linkedText;
      await putOverwrite(token, id, cfg.staffRoleId, 0, staffAllow, "0");
    }
    if (botUserId) await putOverwrite(token, id, botUserId, 1, isVoiceLike(ch.type) ? botVoice : botText, "0");
    return;
  }

  if (policy === "linked_speak" && isTextLike(ch.type)) {
    await putOverwrite(
      token,
      id,
      guildId,
      0,
      perm(VIEW, READ_HISTORY, USE_APP_CMD),
      perm(SEND, SEND_IN_THREAD, CREATE_PUB_THREAD, CREATE_PRIV_THREAD, ATTACH_FILES),
    );
    await putOverwrite(token, id, cfg.linkedRoleId, 0, linkedText, "0");
    if (cfg.staffRoleId && cfg.staffRoleId !== cfg.linkedRoleId) {
      await putOverwrite(token, id, cfg.staffRoleId, 0, linkedText, "0");
    }
    if (botUserId) await putOverwrite(token, id, botUserId, 1, botText, "0");
    return;
  }

  if (policy === "linked_speak" && isVoiceLike(ch.type)) {
    await putOverwrite(token, id, guildId, 0, perm(VIEW, READ_HISTORY), perm(CONNECT, SPEAK));
    await putOverwrite(token, id, cfg.linkedRoleId, 0, perm(VIEW, CONNECT, SPEAK, READ_HISTORY), "0");
    if (cfg.staffRoleId && cfg.staffRoleId !== cfg.linkedRoleId) {
      await putOverwrite(token, id, cfg.staffRoleId, 0, perm(VIEW, CONNECT, SPEAK, READ_HISTORY), "0");
    }
    if (botUserId) await putOverwrite(token, id, botUserId, 1, botVoice, "0");
  }
}

const fileEnv = loadRootMcEnv();
const token = rootMcBotToken(fileEnv);
const guildId = process.env.DISCORD_ROOTMC_GUILD_ID || fileEnv.DISCORD_ROOTMC_GUILD_ID || readWranglerVar("DISCORD_ROOTMC_GUILD_ID");
const linkedRoleId =
  process.env.DISCORD_ROOTMC_LINKED_ROLE_ID || fileEnv.DISCORD_ROOTMC_LINKED_ROLE_ID || readWranglerVar("DISCORD_ROOTMC_LINKED_ROLE_ID");
const staffRoleId = process.env.DISCORD_ROOTMC_STAFF_ROLE_ID || fileEnv.DISCORD_ROOTMC_STAFF_ROLE_ID || readWranglerVar("DISCORD_ROOTMC_STAFF_ROLE_ID");
const confirm = process.argv.includes("--confirm");

if (!token || !guildId || !linkedRoleId) {
  console.error("Need DISCORD_ROOTMC_BOT_TOKEN, DISCORD_ROOTMC_GUILD_ID, DISCORD_ROOTMC_LINKED_ROLE_ID.");
  process.exit(1);
}

const cfg = {
  linkedRoleId,
  staffRoleId,
  rulesChannelId:
    process.env.DISCORD_ROOTMC_RULES_CHANNEL_ID ||
    fileEnv.DISCORD_ROOTMC_RULES_CHANNEL_ID ||
    readWranglerVar("DISCORD_ROOTMC_RULES_CHANNEL_ID"),
  staffChannelIds: new Set(
    [
      "DISCORD_ROOTMC_ADMINS_CHANNEL_ID",
      "DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID",
      "DISCORD_ROOTMC_BOT_SPAM_CHANNEL_ID",
      "DISCORD_ROOTMC_AI_ARCHIVE_CHANNEL_ID",
      "DISCORD_ROOTMC_OPERATIONS_FORUM_CHANNEL_ID",
      "DISCORD_ROOTMC_APPEALS_FORUM_CHANNEL_ID",
    ]
      .map((k) => process.env[k] || fileEnv[k] || readWranglerVar(k))
      .filter(Boolean),
  ),
  skipCategories: [
    "DISCORD_ROOTMC_TOWN_CATEGORY_ID",
    "DISCORD_ROOTMC_NATION_CATEGORY_ID",
    "DISCORD_ROOTMC_TOWN_ARCHIVE_CATEGORY_ID",
    "DISCORD_ROOTMC_NATION_ARCHIVE_CATEGORY_ID",
    "DISCORD_ROOTMC_REPORT_TICKETS_CATEGORY_ID",
  ]
    .map((k) => process.env[k] || fileEnv[k] || readWranglerVar(k))
    .filter(Boolean),
};

const channels = await discordReq(token, "GET", `/guilds/${guildId}/channels`);
const byId = new Map(channels.map((c) => [String(c.id), c]));
const me = await discordReq(token, "GET", "/users/@me");
const botUserId = me?.id ? String(me.id) : "";

let updated = 0;
let skipped = 0;
let errors = 0;

for (const ch of channels) {
  const policy = resolvePolicy(ch, cfg, byId);
  if (policy === "skip") {
    skipped++;
    continue;
  }
  console.log(JSON.stringify({ channel: ch.id, name: ch.name, type: ch.type, policy, write: confirm }));
  if (!confirm) {
    updated++;
    continue;
  }
  try {
    await applyPolicy(token, guildId, ch, policy, cfg, botUserId);
    updated++;
    await sleep(250);
  } catch (e) {
    errors++;
    console.error("apply_failed", ch.id, ch.name, e instanceof Error ? e.message : e);
  }
}

console.log(
  JSON.stringify(
    {
      dry_run: !confirm,
      guild_id: guildId,
      linked_role_id: linkedRoleId,
      updated,
      skipped,
      errors,
    },
    null,
    2,
  ),
);

if (!confirm) {
  console.log("\nDry run only. Re-run with --confirm to apply permission overwrites.");
}
