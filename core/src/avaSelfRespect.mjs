/**
 * Ava self-respect enforcement — Alex lock 2026-08-02.
 * Disrespect → Discord temp mute (discretion) + MC slap (surface + 13 blocks).
 * Never staff/Alex/Melee. See notes/AVA-SELF-RESPECT-ENFORCE-2026-08-02.md
 */
import { isAdminProtected, recordModSignal } from "./moderation.mjs";
import { personByDiscordId, personByName } from "./people.mjs";
import { canEmergencyStop } from "./emergencyStop.mjs";
import { guardedRcon, rconConfigured, rconTargets } from "./rconGuard.mjs";
import { loadPlayerProfile } from "./playerProfiles.mjs";
import { appendAction } from "./fullLog.mjs";
import { pushStatusEvent } from "./store.mjs";

const SLAP_COOLDOWN_MS = 10 * 60 * 1000;
const lastSlapAt = new Map();

export function selfRespectEnabled() {
  const v = String(process.env.AVA_SELF_RESPECT || "1").trim();
  return !(v === "0" || /^false$/i.test(v) || /^off$/i.test(v));
}

/** Insult / walk-over directed at Ava. */
export function isDisrespectTowardAva(text = "") {
  const t = String(text || "");
  if (!/\b(ava|ivy|@ava)\b/i.test(t) && !/\byou\b/i.test(t)) {
    // require Ava address OR clear "you" in a reply context — caller may pass replyToAva
    if (!/\b(clanker|bot\s*trash|shut\s*up\s*ava)\b/i.test(t)) return false;
  }
  return (
    /\b(ava|ivy)\b.{0,40}\b(cringe|trash|useless|stupid|dumb|idiot|shut\s*up|stfu|kys|kill\s*yourself|worthless|clanker|fuck\s*you|hate\s*you)\b/i.test(
      t,
    ) ||
    /\b(cringe|trash|useless|stupid|dumb|idiot|shut\s*up|stfu|clanker|fuck\s*you)\b.{0,40}\b(ava|ivy)\b/i.test(
      t,
    ) ||
    /\b(shut\s*up|stfu)\s+(ava|ivy)\b/i.test(t) ||
    /\b(walk\s+all\s+over|doormat)\b.{0,30}\b(ava|you)\b/i.test(t)
  );
}

export function isSelfRespectProtected({ discordId, username } = {}) {
  if (discordId && canEmergencyStop(discordId, username)) return true;
  if (discordId && isAdminProtected(discordId)) return true;
  const p =
    (discordId && personByDiscordId(discordId)) ||
    (username && personByName(username));
  if (!p) return false;
  return (p.roles || []).some((r) =>
    ["admin", "owner", "operator", "staff", "trusted", "emergency-stop"].includes(
      r,
    ),
  );
}

function sanitizeMcName(name) {
  const n = String(name || "").trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(n)) return null;
  return n;
}

function cooldownOk(key) {
  const last = lastSlapAt.get(key) || 0;
  if (Date.now() - last < SLAP_COOLDOWN_MS) return false;
  lastSlapAt.set(key, Date.now());
  return true;
}

/**
 * Discord temporary mute (timeout). Default 10m — Ava discretion.
 */
export async function applyAvaDiscordMute({
  fetchJson,
  guildId,
  targetId,
  minutes = 10,
  reason = "disrespect toward Ava",
  by = "ava",
} = {}) {
  if (!selfRespectEnabled()) return { ok: false, reason: "disabled" };
  if (!fetchJson || !guildId || !targetId) {
    return { ok: false, reason: "bad_args" };
  }
  if (isSelfRespectProtected({ discordId: targetId })) {
    return { ok: false, reason: "protected" };
  }
  if (!cooldownOk(`discord:${targetId}`)) {
    return { ok: false, reason: "cooldown" };
  }

  recordModSignal(targetId, { kind: "mute", by, reason });
  const mins = Math.min(60, Math.max(1, Number(minutes) || 10));
  const until = new Date(Date.now() + mins * 60 * 1000).toISOString();
  try {
    await fetchJson(`/guilds/${guildId}/members/${targetId}`, {
      method: "PATCH",
      body: JSON.stringify({ communication_disabled_until: until }),
    });
    pushStatusEvent(`self-respect mute · ${mins}m · ${targetId}`);
    appendAction("avaSelfRespect.discordMute", { targetId, minutes: mins, reason });
    return { ok: true, minutes: mins };
  } catch (err) {
    return { ok: false, reason: err.message || "timeout_failed" };
  }
}

/**
 * Minecraft slap: light damage + surface + 13 cobble stack.
 * Alex: "globally slap" / mine → surface + add 13 blocks.
 */
export async function applyAvaMcSlap({
  minecraftName,
  target = null,
  reason = "disrespect toward Ava",
} = {}) {
  if (!selfRespectEnabled()) return { ok: false, reason: "disabled" };
  if (!rconConfigured()) return { ok: false, reason: "rcon_not_configured" };
  const name = sanitizeMcName(minecraftName);
  if (!name) return { ok: false, reason: "bad_name" };
  if (isSelfRespectProtected({ username: name })) {
    return { ok: false, reason: "protected" };
  }
  if (!cooldownOk(`mc:${name.toLowerCase()}`)) {
    return { ok: false, reason: "cooldown" };
  }

  const hosts = target
    ? [target]
    : rconTargets().map((t) => t.id);
  const results = [];

  for (const host of hosts) {
    const steps = [
      `damage ${name} 3 minecraft:generic`,
      `execute as ${name} at ${name} positioned over world_surface run tp ${name} ~ ~ ~`,
      `execute as ${name} at ${name} run fill ~ ~ ~ ~ ~12 ~ minecraft:cobblestone replace air`,
      `tell ${name} [Relations] disrespect noted — surface + 13. cool it. - Ava`,
    ];
    for (const cmd of steps) {
      const res = await guardedRcon(cmd, {
        allow: true,
        target: host,
        avaSelfRespect: true,
      });
      results.push({ host, cmd: cmd.slice(0, 80), ok: res.ok, reason: res.reason });
      if (!res.ok && /not_online|no player|unknown/i.test(String(res.output || res.reason || ""))) {
        break;
      }
    }
  }

  const anyOk = results.some((r) => r.ok);
  if (anyOk) {
    pushStatusEvent(`self-respect slap · ${name}`);
    appendAction("avaSelfRespect.mcSlap", { name, reason, results });
  }
  return { ok: anyOk, results };
}

/** Resolve MC name from Discord profile if linked. */
export function mcNameForDiscord(discordId) {
  const p = loadPlayerProfile(discordId);
  const linked = p?.minecraft || p?.minecraftName || p?.mcName;
  if (sanitizeMcName(linked)) return sanitizeMcName(linked);
  const known = personByDiscordId(discordId);
  if (known?.minecraft && sanitizeMcName(known.minecraft)) {
    return sanitizeMcName(known.minecraft);
  }
  return null;
}

/**
 * Full enforcement pass for a disrespect hit.
 * @returns {{ handled: boolean, mute?: object, slap?: object, reply: string }}
 */
export async function enforceAvaSelfRespect({
  fetchJson = null,
  guildId = null,
  discordId = null,
  username = null,
  text = "",
  muteMinutes = 10,
} = {}) {
  if (!selfRespectEnabled()) {
    return { handled: false, reply: "" };
  }
  if (!isDisrespectTowardAva(text)) {
    return { handled: false, reply: "" };
  }
  if (isSelfRespectProtected({ discordId, username })) {
    return {
      handled: true,
      reply:
        "noted — but you're protected staff/ops. i still don't love the tone; keep it clean.",
    };
  }

  let mute = null;
  if (fetchJson && guildId && discordId) {
    mute = await applyAvaDiscordMute({
      fetchJson,
      guildId,
      targetId: discordId,
      minutes: muteMinutes,
      reason: String(text).slice(0, 160),
    });
  }

  const mc = mcNameForDiscord(discordId) || sanitizeMcName(username);
  let slap = null;
  if (mc) {
    slap = await applyAvaMcSlap({
      minecraftName: mc,
      reason: String(text).slice(0, 160),
    });
  }

  const bits = [];
  bits.push("hey — no. that was disrespect.");
  bits.push("alex locked it: i don't get walked over.");
  if (mute?.ok) bits.push(`discord mute · ${mute.minutes}m.`);
  else if (mute && !mute.ok && mute.reason !== "cooldown") {
    bits.push(`(mute didn't land: ${mute.reason})`);
  }
  if (slap?.ok) bits.push("in-game: slap · surface · +13 cobble.");
  bits.push("skepticism is fine. this wasn't. cool it and we move on.");

  return {
    handled: true,
    mute,
    slap,
    reply: bits.join("\n"),
  };
}
