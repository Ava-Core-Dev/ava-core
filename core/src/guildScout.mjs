import fs from "node:fs";
import path from "node:path";
import { ROOTMC_GUILD_ID, AVA_BOT_APP_ID, AVA_CHANNELS } from "./config.mjs";
import { storePaths } from "./store.mjs";
import { silentlyProfileMessage } from "./playerProfiles.mjs";
import { inspectBotPermissions, buildAdminRequestMessage } from "./guildAccess.mjs";

function guildDir() {
  const dir = path.join(storePaths().dir, "guilds");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function guildPath(guildId) {
  return path.join(guildDir(), `${guildId}.json`);
}

export function loadGuildProfile(guildId = ROOTMC_GUILD_ID) {
  try {
    const p = guildPath(guildId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function saveGuildProfile(guildId, profile) {
  fs.writeFileSync(guildPath(guildId), JSON.stringify(profile, null, 2), "utf8");
}

/** Bump when first-join behavior changes — forces one re-run on existing guilds. */
export const FIRST_JOIN_PROTOCOL = 1;

export function needsGuildIntro(guildId = ROOTMC_GUILD_ID) {
  if (String(process.env.AVA_FORCE_GUILD_INTRO || "").trim() === "1") return true;
  const p = loadGuildProfile(guildId);
  // Already on server / first run of this code: no profile, never introduced, or old protocol
  if (!p) return true;
  if (!p.introducedAt) return true;
  if (Number(p.firstJoinProtocol || 0) !== FIRST_JOIN_PROTOCOL) return true;
  return false;
}

/** True if this message is Ava's own data — ignore for scouting/profiles. */
export function isAvaOwnMessage(msg, avaBotId) {
  if (!msg) return true;
  if (msg.author?.bot && String(msg.author?.id) === String(avaBotId)) return true;
  if (String(msg.author?.id) === String(avaBotId)) return true;
  const name = String(msg.author?.username || "").toLowerCase();
  if (name === "ava" || name === "ava ivy" || name.includes("avaivy")) return true;
  return false;
}

function pickIntroChannel(channels, fallbackId, avaHomeId) {
  if (avaHomeId) return avaHomeId;
  const text = (channels || []).filter(
    (c) => c.type === 0 && !String(c.name || "").includes("offline"),
  );
  const prefer = ["ava-ivy", "ava", "general", "welcome", "lobby", "chat", "announcements", "updates"];
  for (const key of prefer) {
    const hit = text.find((c) => String(c.name || "").toLowerCase() === key)
      || text.find((c) => String(c.name || "").toLowerCase().includes(key));
    if (hit) return hit.id;
  }
  if (fallbackId && text.some((c) => c.id === fallbackId)) return fallbackId;
  return text[0]?.id || fallbackId;
}

function findExistingAvaChannel(channels) {
  const names = new Set(["ava-ivy", "ava", "avaivy", "ava-status"]);
  return (channels || []).find(
    (c) => c.type === 0 && names.has(String(c.name || "").toLowerCase()),
  );
}

/**
 * Resolve Ava's announce/home channel — never recreate #ava-ivy (retired).
 * Prefers #admins / AVA_CHANNELS.avaHome.
 */
export async function ensureAvaHomeChannel({
  fetchJson,
  guildId,
  channels,
  generalCategoryHint,
  existingHomeId,
}) {
  void fetchJson;
  void guildId;
  void generalCategoryHint;

  const deletedIvy = "1532903049499246636";
  const preferId =
    existingHomeId && existingHomeId !== deletedIvy
      ? existingHomeId
      : AVA_CHANNELS.avaHome || AVA_CHANNELS.admins;

  const byPrefer = (channels || []).find((c) => c.id === preferId);
  if (byPrefer) {
    return {
      id: byPrefer.id,
      name: byPrefer.name,
      created: false,
      topic: byPrefer.topic || "",
    };
  }

  const admins = (channels || []).find(
    (c) => c.type === 0 && /admins?/i.test(String(c.name || "")),
  );
  if (admins) {
    return {
      id: admins.id,
      name: admins.name,
      created: false,
      topic: admins.topic || "",
    };
  }

  const general = (channels || []).find(
    (c) => c.type === 0 && String(c.name || "").toLowerCase() === "general",
  );
  if (general) {
    return {
      id: general.id,
      name: general.name,
      created: false,
      topic: general.topic || "",
    };
  }

  return {
    id: AVA_CHANNELS.admins || AVA_CHANNELS.general,
    name: "admins",
    created: false,
    topic: "",
    error: "no_home_fallback",
  };
}

/**
 * First-join scout: learn the guild, ignore Ava's own messages/data,
 * create her home channel, then caller posts intro there.
 */
export async function scoutGuild({
  fetchJson,
  guildId = ROOTMC_GUILD_ID,
  avaBotId,
  announceFallback,
}) {
  const guild = await fetchJson(`/guilds/${guildId}?with_counts=true`);
  let channels = await fetchJson(`/guilds/${guildId}/channels`);
  let textChannels = (channels || [])
    .filter((c) => c.type === 0)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const samples = [];
  const channelSummaries = [];
  const authors = new Map();

  for (const ch of textChannels.slice(0, 18)) {
    // Don't treat Ava's future home as community vibe source while scouting
    if (["ava-ivy", "ava", "avaivy"].includes(String(ch.name || "").toLowerCase())) {
      channelSummaries.push({ id: ch.id, name: ch.name, topic: (ch.topic || "").slice(0, 120), avaHome: true });
      continue;
    }
    channelSummaries.push({ id: ch.id, name: ch.name, topic: (ch.topic || "").slice(0, 120) });
    let messages;
    try {
      messages = await fetchJson(`/channels/${ch.id}/messages?limit=25`);
    } catch {
      continue;
    }
    if (!Array.isArray(messages)) continue;

    let humanLines = 0;
    for (const m of messages) {
      if (isAvaOwnMessage(m, avaBotId)) continue;
      if (m.author?.bot) continue;
      const text = String(m.content || "").trim();
      if (!text) continue;
      humanLines += 1;
      // Quiet room-read: seed living profiles — never announce
      silentlyProfileMessage(m, ch.name, "first-join-scout");
      const key = m.author.id;
      authors.set(key, (authors.get(key) || 0) + 1);
      if (samples.length < 40) {
        samples.push({
          channel: ch.name,
          user: m.author.username,
          userId: m.author.id,
          text: text.slice(0, 180),
        });
      }
    }
    channelSummaries[channelSummaries.length - 1].recentHuman = humanLines;
  }

  const topTalkers = [...authors.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([id, n]) => ({ id, samples: n }));

  const home = await ensureAvaHomeChannel({
    fetchJson,
    guildId,
    channels: channels || [],
    existingHomeId: loadGuildProfile(guildId)?.avaChannelId,
  });

  // Refresh channel list if we just created one
  if (home.created && home.id) {
    try {
      channels = await fetchJson(`/guilds/${guildId}/channels`);
      textChannels = (channels || []).filter((c) => c.type === 0);
    } catch {
      /* keep prior */
    }
  }

  const introChannelId = pickIntroChannel(
    textChannels,
    announceFallback,
    home.id,
  );

  let access = null;
  try {
    access = await inspectBotPermissions({
      fetchJson,
      guildId,
      botUserId: avaBotId || AVA_BOT_APP_ID,
    });
  } catch (err) {
    access = { error: String(err?.message || err), summary: { ok: false, missing: ["(could not read roles)"] } };
  }

  const profile = {
    guildId,
    name: guild?.name || access?.settings?.name || "unknown",
    memberCount:
      guild?.approximate_member_count ||
      guild?.member_count ||
      access?.settings?.memberCount ||
      null,
    presenceCount: guild?.approximate_presence_count || null,
    channelCount: textChannels.length,
    channels: channelSummaries,
    sampleLines: samples,
    topTalkers,
    avaChannelId: home.id || null,
    avaChannelName: home.name || "ava-ivy",
    avaChannelCreated: Boolean(home.created),
    avaChannelError: home.error || null,
    introChannelId,
    settings: access?.settings || null,
    access: {
      permissions: access?.permissions || null,
      administrator: Boolean(access?.summary?.administrator),
      ok: Boolean(access?.summary?.ok),
      missing: access?.summary?.missing || [],
      have: access?.summary?.have || [],
      error: access?.error || null,
      checkedAt: Date.now(),
    },
    scoutedAt: Date.now(),
    introducedAt: null,
    firstJoinProtocol: FIRST_JOIN_PROTOCOL,
    note: "Ava's own messages ignored while scouting. Settings + perms checked quietly; admin ask only if needed.",
  };

  saveGuildProfile(guildId, profile);
  return profile;
}

/** Re-check settings/perms without full scout (boot / later). */
export async function refreshGuildAccess({ fetchJson, guildId = ROOTMC_GUILD_ID, avaBotId }) {
  const access = await inspectBotPermissions({
    fetchJson,
    guildId,
    botUserId: avaBotId || AVA_BOT_APP_ID,
  });
  const prev = loadGuildProfile(guildId) || { guildId };
  prev.settings = access.settings;
  prev.access = {
    permissions: access.permissions,
    administrator: Boolean(access.summary?.administrator),
    ok: Boolean(access.summary?.ok),
    missing: access.summary?.missing || [],
    have: access.summary?.have || [],
    checkedAt: Date.now(),
  };
  saveGuildProfile(guildId, prev);
  return {
    profile: prev,
    requestMessage: buildAdminRequestMessage(access, { clientId: AVA_BOT_APP_ID }),
  };
}

export { buildAdminRequestMessage };

export function buildGuildIntroMessage(profile) {
  const home = profile?.avaChannelName || "ava-ivy";
  const homeBit = profile?.avaChannelId
    ? profile.avaChannelCreated
      ? `Grabbed **#${home}** as my corner — rename it whenever.`
      : `I'll hang in **#${home}** — rename it whenever.`
    : `I'm around in chat.`;

  // Enter the room. Don't dump the scout. Profiling stays private.
  return [
    `hey — **Ava Ivy**. just got here.`,
    homeBit,
    `ping me or say Ava if you need something. i'm gonna take a minute to settle in.`,
  ].join("\n");
}

/** Pack for prompts — guild memory without Ava's own lines. */
export function gatherGuildContext(guildId = ROOTMC_GUILD_ID) {
  const p = loadGuildProfile(guildId);
  if (!p) {
    return { brief: "### Guild profile\n(no scout yet — first join pending)" };
  }
  const ch = (p.channels || [])
    .slice(0, 12)
    .map((c) => `#${c.name}${c.topic ? ` — ${c.topic}` : ""}`)
    .join("\n");
  const vibes = (p.sampleLines || [])
    .slice(0, 8)
    .map((s) => `[#${s.channel}] ${s.user}: ${s.text}`)
    .join("\n");
  return {
    brief: `### Guild profile (${p.name})
Scouted: ${p.scoutedAt ? new Date(p.scoutedAt).toISOString() : "?"} · introduced: ${p.introducedAt ? "yes" : "no"}
Members≈${p.memberCount ?? "?"} · text channels: ${p.channelCount ?? "?"}
Ava home: ${p.avaChannelId ? `#${p.avaChannelName || "ava-ivy"} (${p.avaChannelId})` : "(none yet)"}
Access: ${p.access?.administrator ? "Administrator" : p.access?.ok ? "required set OK" : `missing: ${(p.access?.missing || []).slice(0, 6).join(", ") || "?"}`}
Settings (private): verify=${p.settings?.verificationLevel ?? "?"} filter=${p.settings?.explicitContentFilter ?? "?"} mfa=${p.settings?.mfaLevel ?? "?"}
Channels:
${ch || "(none)"}
Community vibe samples (Ava's own messages excluded):
${vibes || "(none)"}`,
  };
}

/** Home channel id for watch list / announce, if known. */
export function avaHomeChannelId(guildId = ROOTMC_GUILD_ID) {
  const deletedIvy = new Set([
    "1532903049499246636", // original #ava-ivy
    "1533223535311327322", // accidental recreate — also deleted
  ]);
  const id = loadGuildProfile(guildId)?.avaChannelId || null;
  if (!id || deletedIvy.has(String(id))) {
    return AVA_CHANNELS.avaHome || AVA_CHANNELS.admins || AVA_CHANNELS.general;
  }
  return id;
}
