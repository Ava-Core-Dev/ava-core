/**
 * Discord guild ops: reorganize (no deletes), permission locks, role strip.
 *
 * Run from `Web/cloudflare/rootrecord-api-account/` with DISCORD_BOT_TOKEN + guild vars in credentials.env.
 *
 *   node scripts/discord-guild-ops.mjs dry-run
 *   node scripts/discord-guild-ops.mjs apply-layout --dry-run
 *   node scripts/discord-guild-ops.mjs apply-layout --confirm
 *   node scripts/discord-guild-ops.mjs apply-locks --dry-run
 *   node scripts/discord-guild-ops.mjs apply-locks --confirm
 *   node scripts/discord-guild-ops.mjs strip-roles --dry-run
 *   node scripts/discord-guild-ops.mjs strip-roles --confirm
 *
 *   node scripts/discord-guild-ops.mjs unverified-readonly --dry-run
 *   node scripts/discord-guild-ops.mjs unverified-readonly --confirm
 *   # Optional: DISCORD_ADMIN_CHANNEL_IDS=id1,id2 (extra channels to hide from @everyone)
 *
 * Suggested order: apply-layout → apply-locks → strip-roles
 *
 * strip-roles: humans without Verified/Developer → managed-only roles; skips bots, @Verified, Developer.
 *
 * Defaults (override via env / credentials): guild + verified + welcome + announcements + verified-chat
 * match wrangler.toml / prior setup.
 */
import fs from "node:fs";
import path from "node:path";

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

function s(b) {
  return String(b);
}

function readEnvFile(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
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

function findCredentialsPath() {
  if (process.env.CREDENTIALS_ENV && fs.existsSync(process.env.CREDENTIALS_ENV)) return process.env.CREDENTIALS_ENV;
  const here = process.cwd();
  for (const p of [
    path.join(here, "credentials.env"),
    path.join(here, "../../../credentials.env"),
    path.join(here, "../../../../credentials.env"),
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(here, "../../../credentials.env");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function discordReq(token, method, path, body) {
  const url = `${API}${path.startsWith("/") ? path : "/" + path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bot ${token.trim()}`,
      "User-Agent": "RootRecord/discord-guild-ops",
    },
  };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json; charset=utf-8";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let j = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    j = { _raw: text.slice(0, 400) };
  }
  const ra = res.headers.get("Retry-After");
  if (ra) await sleep(Number(ra) * 1000 + 200);
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status;
    throw err;
  }
  return j;
}

async function discordGet(token, path) {
  return discordReq(token, "GET", path, undefined);
}
async function discordPatch(token, path, body) {
  return discordReq(token, "PATCH", path, body);
}
async function discordPost(token, path, body) {
  return discordReq(token, "POST", path, body);
}
async function discordPutOverwrite(token, channelId, overwriteId, payload) {
  return discordReq(
    token,
    "PUT",
    `/channels/${encodeURIComponent(channelId)}/permissions/${encodeURIComponent(overwriteId)}`,
    payload,
  );
}

function channelTypeName(t) {
  const m = { 0: "text", 2: "voice", 4: "category", 5: "news", 10: "thread", 11: "thread", 12: "thread", 13: "stage", 15: "forum" };
  return m[t] || `type_${t}`;
}

function guessBucket(ch) {
  const name = String(ch.name || "").toLowerCase();
  if (/welcome|verify|start|rules|how-to|faq/.test(name)) return "start";
  if (/announce|news|feed|dev|changelog|update|patch/.test(name)) return "ops";
  if (/voice|stage|music|talk/.test(name) && ch.type === 2) return "voice";
  if (/support|help|ticket|bug/.test(name)) return "support";
  if (ch.type === 2 || ch.type === 13) return "voice";
  return "community";
}

const CAT = {
  start: "00 · Start here",
  ops: "01 · Ops & feed",
  verified: "02 · Verified",
  community: "03 · Community",
  support: "04 · Support",
  voice: "05 · Voice",
};

/** Env / role name `Developer` / known RootRecord guild id → strip-roles skips these members. */
function resolveDeveloperRoleId(roles, fileEnv, guildId) {
  const fromEnv = String(process.env.DISCORD_DEVELOPER_ROLE_ID || fileEnv.DISCORD_DEVELOPER_ROLE_ID || "").trim();
  if (fromEnv) return fromEnv;
  for (const r of roles || []) {
    if (!r || !r.id) continue;
    if (String(r.name || "").trim().toLowerCase() === "developer") return String(r.id);
  }
  if (guildId === "1497039564345442406") return "1497040541559558175";
  return "";
}

async function loadCtx() {
  const credPath = findCredentialsPath();
  const fileEnv = readEnvFile(credPath);
  const token = String(process.env.DISCORD_BOT_TOKEN || fileEnv.DISCORD_BOT_TOKEN || "").trim();
  const guildId = String(process.env.DISCORD_GUILD_ID || fileEnv.DISCORD_GUILD_ID || "1497039564345442406").trim();
  const verifiedRoleId = String(
    process.env.DISCORD_VERIFIED_ROLE_ID || fileEnv.DISCORD_VERIFIED_ROLE_ID || "1504042901963804742",
  ).trim();
  const welcomeChannelId = String(
    process.env.DISCORD_WELCOME_CHANNEL_ID || fileEnv.DISCORD_WELCOME_CHANNEL_ID || "1497160346358644767",
  ).trim();
  const announcementsChannelId = String(
    process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID || fileEnv.DISCORD_ANNOUNCEMENTS_CHANNEL_ID || "1500286864119038103",
  ).trim();
  const verifiedChatChannelId = String(
    process.env.DISCORD_VERIFIED_CHAT_CHANNEL_ID || fileEnv.DISCORD_VERIFIED_CHAT_CHANNEL_ID || "1497039565461000214",
  ).trim();

  if (!token) {
    console.error("Missing DISCORD_BOT_TOKEN. credentials path:", credPath, fs.existsSync(credPath) ? "exists" : "missing");
    process.exit(1);
  }

  const me = await discordGet(token, "/users/@me");
  const botUserId = String(me.id || "");

  const [channels, roles, guild] = await Promise.all([
    discordGet(token, `/guilds/${encodeURIComponent(guildId)}/channels`),
    discordGet(token, `/guilds/${encodeURIComponent(guildId)}/roles`),
    discordGet(token, `/guilds/${encodeURIComponent(guildId)}`),
  ]);

  const roleById = new Map();
  for (const r of roles || []) {
    if (r && r.id) roleById.set(String(r.id), r);
  }

  const developerRoleId = resolveDeveloperRoleId(roles, fileEnv, guildId);

  const adminChannelIdsExtra = String(
    process.env.DISCORD_ADMIN_CHANNEL_IDS || fileEnv.DISCORD_ADMIN_CHANNEL_IDS || "",
  )
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter((x) => /^\d{10,22}$/.test(x));

  return {
    token,
    guildId,
    verifiedRoleId,
    developerRoleId,
    adminChannelIdsExtra,
    welcomeChannelId,
    announcementsChannelId,
    verifiedChatChannelId,
    botUserId,
    channels: Array.isArray(channels) ? channels : [],
    roles: Array.isArray(roles) ? roles : [],
    roleById,
    guild,
    credPath,
  };
}

function findCategory(channels, name) {
  return channels.find((c) => c.type === 4 && c.name === name);
}

/** Which logical bucket (maps to CAT.* name). */
function targetParentKey(ch, ctx) {
  const id = String(ch.id);
  if (ch.type === 4) return null;
  if (id === ctx.welcomeChannelId) return "start";
  if (id === ctx.announcementsChannelId) return "ops";
  if (id === ctx.verifiedChatChannelId) return "verified";
  return guessBucket(ch);
}

function catIdsFromChannelList(channels) {
  const ids = {};
  for (const [key, name] of Object.entries(CAT)) {
    const c = findCategory(channels, name);
    ids[key] = c ? String(c.id) : null;
  }
  return ids;
}

async function applyLayout(ctx, write) {
  let channels = ctx.channels;

  const missingCats = [];
  for (const [key, name] of Object.entries(CAT)) {
    if (!findCategory(channels, name)) missingCats.push({ key, name });
  }

  if (!write) {
    console.log(JSON.stringify({ phase: "layout_dry", missingCategories: missingCats }, null, 2));
    for (const ch of channels) {
      if (ch.type === 4) continue;
      const pk = targetParentKey(ch, ctx);
      const catName = pk ? CAT[pk] : null;
      console.log(
        JSON.stringify({
          channel_id: ch.id,
          name: ch.name,
          type: channelTypeName(ch.type),
          would_move_under_category: catName,
        }),
      );
    }
    const newSpecs = [
      { name: "verified-general", parent: CAT.verified },
      { name: "verified-support", parent: CAT.support },
      { name: "product-weather", parent: CAT.verified },
      { name: "product-business", parent: CAT.verified },
    ];
    const names = new Set(channels.filter((c) => c.name).map((c) => String(c.name).toLowerCase()));
    for (const spec of newSpecs) {
      if (!names.has(spec.name.toLowerCase())) console.log("Would create text channel:", spec);
    }
    return;
  }

  for (const m of missingCats) {
    await discordPost(ctx.token, `/guilds/${encodeURIComponent(ctx.guildId)}/channels`, {
      name: m.name,
      type: 4,
      permission_overwrites: [],
    });
    await sleep(450);
    console.log("Created category", m.name);
  }

  channels = await discordGet(ctx.token, `/guilds/${encodeURIComponent(ctx.guildId)}/channels`);
  ctx.channels = channels;

  const catIds = catIdsFromChannelList(channels);
  for (const [k, v] of Object.entries(catIds)) {
    if (!v) {
      console.error("Still missing category after create:", k, CAT[k]);
      process.exit(1);
    }
  }

  const newChannelSpecs = [
    { name: "verified-general", parentKey: "verified", type: 0 },
    { name: "verified-support", parentKey: "support", type: 0 },
    { name: "product-weather", parentKey: "verified", type: 0 },
    { name: "product-business", parentKey: "verified", type: 0 },
  ];
  const existingNames = new Set(channels.filter((c) => c.name).map((c) => String(c.name).toLowerCase()));
  for (const spec of newChannelSpecs) {
    if (existingNames.has(spec.name.toLowerCase())) continue;
    await discordPost(ctx.token, `/guilds/${encodeURIComponent(ctx.guildId)}/channels`, {
      name: spec.name,
      type: spec.type,
      parent_id: catIds[spec.parentKey],
    });
    await sleep(450);
    console.log("Created channel", spec.name);
  }

  channels = await discordGet(ctx.token, `/guilds/${encodeURIComponent(ctx.guildId)}/channels`);
  ctx.channels = channels;
  const catIds2 = catIdsFromChannelList(channels);

  const moves = [];
  for (const ch of channels) {
    if (ch.type === 4) continue;
    const pk = targetParentKey(ch, ctx);
    if (!pk) continue;
    const want = catIds2[pk];
    const cur = ch.parent_id ? String(ch.parent_id) : "";
    if (want && cur !== want) moves.push({ id: ch.id, name: ch.name, to: want });
  }
  console.log(JSON.stringify({ phase: "parent_moves", count: moves.length }, null, 2));
  for (const m of moves) {
    await discordPatch(ctx.token, `/channels/${encodeURIComponent(m.id)}`, { parent_id: m.to });
    await sleep(350);
  }
  console.log("apply-layout done. parent_id updates:", moves.length);
}

function isTextLike(t) {
  return t === 0 || t === 5 || t === 15 || t === 12;
}
function isVoiceLike(t) {
  return t === 2 || t === 13;
}

async function applyLocks(ctx, write) {
  const { token, guildId, verifiedRoleId, welcomeChannelId, botUserId, channels } = ctx;

  const botText = s(VIEW | READ_HISTORY | SEND);
  const botVoice = s(VIEW | CONNECT | SPEAK);

  for (const ch of channels) {
    if (ch.type === 4) continue;
    const id = String(ch.id);
    const isWelcome = id === welcomeChannelId;

    if (isWelcome) {
      const everyoneAllow = s(VIEW | READ_HISTORY);
      const everyoneDeny = s(SEND);
      console.log(JSON.stringify({ channel: id, name: ch.name, policy: "welcome_read_only" }));
      if (write) {
        await discordPutOverwrite(token, id, guildId, { type: 0, allow: everyoneAllow, deny: everyoneDeny });
        await sleep(220);
        await discordPutOverwrite(token, id, verifiedRoleId, {
          type: 0,
          allow: s(VIEW | READ_HISTORY | SEND),
          deny: "0",
        });
        await sleep(220);
      }
      continue;
    }

    if (isTextLike(ch.type)) {
      const everyoneDeny = s(VIEW | SEND);
      const verifiedAllow = s(VIEW | SEND | READ_HISTORY);
      console.log(JSON.stringify({ channel: id, name: ch.name, type: "text_like", policy: "verified_only" }));
      if (write) {
        await discordPutOverwrite(token, id, guildId, { type: 0, allow: "0", deny: everyoneDeny });
        await sleep(220);
        await discordPutOverwrite(token, id, verifiedRoleId, { type: 0, allow: verifiedAllow, deny: "0" });
        await sleep(220);
        if (botUserId) {
          await discordPutOverwrite(token, id, botUserId, { type: 1, allow: botText, deny: "0" });
          await sleep(220);
        }
      }
      continue;
    }

    if (isVoiceLike(ch.type)) {
      const everyoneDeny = s(VIEW | CONNECT | SPEAK);
      const verifiedAllow = s(VIEW | CONNECT | SPEAK | READ_HISTORY);
      console.log(JSON.stringify({ channel: id, name: ch.name, type: "voice_like", policy: "verified_only" }));
      if (write) {
        await discordPutOverwrite(token, id, guildId, { type: 0, allow: "0", deny: everyoneDeny });
        await sleep(220);
        await discordPutOverwrite(token, id, verifiedRoleId, { type: 0, allow: verifiedAllow, deny: "0" });
        await sleep(220);
        if (botUserId) {
          await discordPutOverwrite(token, id, botUserId, { type: 1, allow: botVoice, deny: "0" });
          await sleep(220);
        }
      }
    }
  }
}

function channelByIdFromList(channels) {
  const m = new Map();
  for (const c of channels || []) {
    if (c && c.id != null) m.set(String(c.id), c);
  }
  return m;
}

/** Staff / private ops channels: keep hidden from @everyone (verified+dev+ bot only). */
function isAdminLikeChannel(ch, channelById, extraAdminIds) {
  const id = String(ch.id || "");
  if (extraAdminIds.includes(id)) return true;
  const name = String(ch.name || "").toLowerCase();
  const topic = String(ch.topic || "").toLowerCase();
  const hay = `${name} ${topic}`;
  if (
    /\badmin\b|\bmoderators?\b|\bmod-?only\b|\bmod-?room\b|\bstaff-?only\b|\bstaff-?room\b|\binternal\b|\baudit\b|\bowner-?only\b|\bops-?private\b/.test(
      hay,
    )
  ) {
    return true;
  }
  const parentId = ch.parent_id ? String(ch.parent_id) : "";
  if (parentId) {
    const parent = channelById.get(parentId);
    if (parent && parent.type === 4) {
      const pn = String(parent.name || "").toLowerCase();
      if (/\badmin\b|\bmoderators?\b|\bmod\b|\binternal\b|\bstaff-?only\b/.test(pn)) return true;
    }
  }
  return false;
}

async function applyUnverifiedReadonly(ctx, write) {
  const { token, guildId, verifiedRoleId, developerRoleId, botUserId, channels, adminChannelIdsExtra } = ctx;
  const channelById = channelByIdFromList(channels);
  const extra = Array.isArray(adminChannelIdsExtra) ? adminChannelIdsExtra : [];

  const botText = s(VIEW | READ_HISTORY | SEND);
  const botVoice = s(VIEW | CONNECT | SPEAK);

  const everyoneNoSend = s(SEND | SEND_IN_THREAD | CREATE_PUB_THREAD | CREATE_PRIV_THREAD | ATTACH_FILES);
  const everyoneRead = s(VIEW | READ_HISTORY | USE_APP_CMD);
  const verifiedTextFull = s(
    VIEW | READ_HISTORY | SEND | USE_APP_CMD | ATTACH_FILES | CREATE_PUB_THREAD | CREATE_PRIV_THREAD | SEND_IN_THREAD,
  );

  for (const ch of channels) {
    if (ch.type === 4) continue;
    const id = String(ch.id);
    const admin = isAdminLikeChannel(ch, channelById, extra);

    if (admin) {
      console.log(JSON.stringify({ channel: id, name: ch.name, type: channelTypeName(ch.type), policy: "admin_hidden" }));
      if (write) {
        if (isTextLike(ch.type)) {
          await discordPutOverwrite(token, id, guildId, { type: 0, allow: "0", deny: s(VIEW | SEND) });
          await sleep(220);
          await discordPutOverwrite(token, id, verifiedRoleId, { type: 0, allow: verifiedTextFull, deny: "0" });
          await sleep(220);
          if (developerRoleId && developerRoleId !== verifiedRoleId) {
            await discordPutOverwrite(token, id, developerRoleId, { type: 0, allow: verifiedTextFull, deny: "0" });
            await sleep(220);
          }
          if (botUserId) {
            await discordPutOverwrite(token, id, botUserId, { type: 1, allow: botText, deny: "0" });
            await sleep(220);
          }
        } else if (isVoiceLike(ch.type)) {
          await discordPutOverwrite(token, id, guildId, { type: 0, allow: "0", deny: s(VIEW | CONNECT | SPEAK) });
          await sleep(220);
          await discordPutOverwrite(token, id, verifiedRoleId, {
            type: 0,
            allow: s(VIEW | CONNECT | SPEAK | READ_HISTORY),
            deny: "0",
          });
          await sleep(220);
          if (developerRoleId && developerRoleId !== verifiedRoleId) {
            await discordPutOverwrite(token, id, developerRoleId, {
              type: 0,
              allow: s(VIEW | CONNECT | SPEAK | READ_HISTORY),
              deny: "0",
            });
            await sleep(220);
          }
          if (botUserId) {
            await discordPutOverwrite(token, id, botUserId, { type: 1, allow: botVoice, deny: "0" });
            await sleep(220);
          }
        }
      }
      continue;
    }

    if (isTextLike(ch.type)) {
      console.log(JSON.stringify({ channel: id, name: ch.name, type: channelTypeName(ch.type), policy: "public_readonly" }));
      if (write) {
        await discordPutOverwrite(token, id, guildId, {
          type: 0,
          allow: everyoneRead,
          deny: everyoneNoSend,
        });
        await sleep(220);
        await discordPutOverwrite(token, id, verifiedRoleId, { type: 0, allow: verifiedTextFull, deny: "0" });
        await sleep(220);
        if (developerRoleId && developerRoleId !== verifiedRoleId) {
          await discordPutOverwrite(token, id, developerRoleId, { type: 0, allow: verifiedTextFull, deny: "0" });
          await sleep(220);
        }
        if (botUserId) {
          await discordPutOverwrite(token, id, botUserId, { type: 1, allow: botText, deny: "0" });
          await sleep(220);
        }
      }
      continue;
    }

    if (isVoiceLike(ch.type)) {
      console.log(JSON.stringify({ channel: id, name: ch.name, type: "voice_like", policy: "public_see_no_join" }));
      if (write) {
        await discordPutOverwrite(token, id, guildId, {
          type: 0,
          allow: s(VIEW | READ_HISTORY),
          deny: s(CONNECT | SPEAK),
        });
        await sleep(220);
        await discordPutOverwrite(token, id, verifiedRoleId, {
          type: 0,
          allow: s(VIEW | CONNECT | SPEAK | READ_HISTORY),
          deny: "0",
        });
        await sleep(220);
        if (developerRoleId && developerRoleId !== verifiedRoleId) {
          await discordPutOverwrite(token, id, developerRoleId, {
            type: 0,
            allow: s(VIEW | CONNECT | SPEAK | READ_HISTORY),
            deny: "0",
          });
          await sleep(220);
        }
        if (botUserId) {
          await discordPutOverwrite(token, id, botUserId, { type: 1, allow: botVoice, deny: "0" });
          await sleep(220);
        }
      }
    }
  }
  console.log(JSON.stringify({ phase: "unverified_readonly_done", write }, null, 2));
}

async function fetchAllMembers(token, guildId) {
  const out = [];
  let after = undefined;
  for (;;) {
    const q = new URLSearchParams({ limit: "1000" });
    if (after) q.set("after", after);
    const path = `/guilds/${encodeURIComponent(guildId)}/members?${q}`;
    try {
      const batch = await discordGet(token, path);
      if (!Array.isArray(batch) || batch.length === 0) break;
      out.push(...batch);
      after = batch[batch.length - 1].user?.id;
      if (batch.length < 1000) break;
      await sleep(450);
    } catch (e) {
      if (e && e.status === 403) {
        console.error(
          "Discord returned 403 listing members. Enable Server Members Intent: Developer Portal → Application → Bot → Privileged Gateway Intents → Server Members Intent ON. Then re-run strip-roles.",
        );
      }
      throw e;
    }
  }
  return out;
}

function managedRolesOnly(member, roleById) {
  const current = Array.isArray(member.roles) ? member.roles.map(String) : [];
  return [...new Set(current.filter((rid) => roleById.get(rid)?.managed))].sort();
}

async function stripRoles(ctx, write) {
  const { token, guildId, verifiedRoleId, developerRoleId, roleById } = ctx;
  const members = await fetchAllMembers(token, guildId);
  let changed = 0;
  let skippedBots = 0;
  let skippedVerified = 0;
  let skippedDeveloper = 0;
  let unchanged = 0;
  console.log(
    JSON.stringify({
      strip_roles_config: {
        verified_role_id: verifiedRoleId,
        developer_role_id: developerRoleId || null,
        note: developerRoleId ? null : "No Developer role id (set DISCORD_DEVELOPER_ROLE_ID or create a role named Developer).",
      },
    }),
  );
  for (const m of members) {
    if (m.user?.bot) {
      skippedBots += 1;
      continue;
    }
    const curRoles = Array.isArray(m.roles) ? m.roles.map(String) : [];
    if (verifiedRoleId && curRoles.includes(verifiedRoleId)) {
      skippedVerified += 1;
      continue;
    }
    if (developerRoleId && curRoles.includes(developerRoleId)) {
      skippedDeveloper += 1;
      continue;
    }
    const want = managedRolesOnly(m, roleById);
    const have = [...curRoles].sort();
    const w = [...want];
    if (have.join(",") === w.join(",")) {
      unchanged += 1;
      continue;
    }
    changed += 1;
    if (changed <= 50 || !write) {
      console.log(JSON.stringify({ user_id: m.user?.id, username: m.user?.username, from: have, to: w }));
    }
    if (write) {
      await discordPatch(token, `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(m.user.id)}`, {
        roles: w,
      });
      await sleep(400);
    }
  }
  console.log(
    JSON.stringify(
      {
        phase: "strip_roles",
        members: members.length,
        skippedBots,
        skippedVerified,
        skippedDeveloper,
        unchanged,
        changed,
        write,
      },
      null,
      2,
    ),
  );
}

async function cmdDryRun(ctx) {
  await applyLayout(ctx, false);
  console.log("--- locks preview ---");
  await applyLocks(ctx, false);
  console.log("(strip-roles: run strip-roles --dry-run separately; needs member list fetch)");
}

function parseMode(argv) {
  const flags = new Set(argv.slice(3));
  if (flags.has("--dry-run")) return "dry";
  if (flags.has("--confirm")) return "write";
  return "none";
}

async function diagnose(ctx) {
  const me = await discordGet(ctx.token, "/users/@me");
  let application = null;
  try {
    application = await discordGet(ctx.token, "/oauth2/applications/@me");
  } catch (e) {
    application = { error: String(e && e.message ? e.message : e) };
  }
  let listMembers = "unknown";
  try {
    await discordGet(ctx.token, `/guilds/${encodeURIComponent(ctx.guildId)}/members?limit=1`);
    listMembers = "ok (Server Members Intent is working for this token)";
  } catch (e) {
    listMembers = {
      status: e.status,
      detail: String(e.message || e).slice(0, 200),
      fix: "Discord Developer Portal → your Application (id below) → Bot → enable Server Members Intent → Save. Wait ~1 min, re-run strip-roles.",
    };
  }
  console.log(
    JSON.stringify(
      {
        bot_user: { id: me.id, username: me.username, bot: me.bot },
        application_id: application && application.id ? application.id : application,
        guild_id: ctx.guildId,
        list_members_probe: listMembers,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const cmd = process.argv[2] || "help";
  const mode = parseMode(process.argv);

  const ctx = await loadCtx();

  if (cmd === "diagnose") {
    await diagnose(ctx);
    return;
  }

  if (cmd === "dry-run") {
    await cmdDryRun(ctx);
    await stripRoles(ctx, false);
    return;
  }

  if (cmd === "apply-layout") {
    if (mode === "none") {
      console.error("Pass --dry-run or --confirm");
      process.exit(1);
    }
    await applyLayout(ctx, mode === "write");
    return;
  }

  if (cmd === "apply-locks") {
    if (mode === "none") {
      console.error("Pass --dry-run or --confirm");
      process.exit(1);
    }
    await applyLocks(ctx, mode === "write");
    return;
  }

  if (cmd === "unverified-readonly") {
    if (mode === "none") {
      console.error("Pass --dry-run or --confirm");
      process.exit(1);
    }
    console.log(
      JSON.stringify({
        note: "Non-admin text/forum/news: @everyone view+slash, no send. Admin-like names/parents + DISCORD_ADMIN_CHANNEL_IDS stay hidden. Voice: see channel, no connect.",
        admin_channel_ids_extra: ctx.adminChannelIdsExtra || [],
      }),
    );
    await applyUnverifiedReadonly(ctx, mode === "write");
    return;
  }

  if (cmd === "strip-roles") {
    if (mode === "none") {
      console.error("Pass --dry-run or --confirm");
      process.exit(1);
    }
    await stripRoles(ctx, mode === "write");
    return;
  }

  console.log(`discord-guild-ops.mjs

  diagnose                    # print application id + test GET /members (needs Server Members Intent)

  dry-run                      # layout + locks preview + strip-roles dry (no writes)

  apply-layout --dry-run       # print category creates + channel moves
  apply-layout --confirm       # creates categories, new channels, reparents

  apply-locks --dry-run
  apply-locks --confirm        # welcome read-only; other text/voice verified-only + bot overwrites

  unverified-readonly --dry-run
  unverified-readonly --confirm
                               # @everyone: read text + use slash; no send (except admin-like channels)
                               # Optional env: DISCORD_ADMIN_CHANNEL_IDS=id,id

  strip-roles --dry-run
  strip-roles --confirm        # strip assignable roles; skips bots, @Verified, Developer (+ managed)

Order: apply-layout --confirm → apply-locks --confirm → strip-roles --confirm
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
