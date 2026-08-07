import { personByDiscordId } from "./people.mjs";
import { savePlayerProfileMut, loadPlayerProfile } from "./playerProfiles.mjs";
import { canEmergencyStop } from "./emergencyStop.mjs";

/**
 * Moderation helpers — cool-down, dual-signal before bans.
 * Admins never banned by Ava. Mass bans / economy / claim wipes blocked.
 */

const COOLDOWN_MS = 15 * 60 * 1000;

export function isAdminProtected(discordId) {
  const p = personByDiscordId(discordId);
  if (!p) return false;
  return (p.roles || []).some((r) =>
    ["admin", "owner", "operator", "staff"].includes(r),
  );
}

export function recordModSignal(targetId, { kind = "warn", by, reason } = {}) {
  if (!targetId) return { ok: false, reason: "no_target" };
  if (isAdminProtected(targetId)) {
    return { ok: false, reason: "admin_protected" };
  }
  const p = savePlayerProfileMut(targetId, (prev) => {
    const signals = Array.isArray(prev.modSignals) ? prev.modSignals : [];
    signals.push({ kind, by, reason: String(reason || "").slice(0, 200), at: Date.now() });
    prev.modSignals = signals.slice(-20);
    prev.lastModAt = Date.now();
    return prev;
  });
  return { ok: true, profile: p };
}

export function canProposeBan(targetId) {
  if (isAdminProtected(targetId)) return { ok: false, reason: "admin_protected" };
  const p = loadPlayerProfile(targetId);
  const signals = (p?.modSignals || []).filter(
    (s) => Date.now() - (s.at || 0) < 24 * 60 * 60 * 1000,
  );
  const warnCount = signals.filter((s) => s.kind === "warn" || s.kind === "mute").length;
  if (warnCount < 2) {
    return { ok: false, reason: "need_dual_signal", warnCount };
  }
  if (p?.lastModAt && Date.now() - p.lastModAt < COOLDOWN_MS) {
    return { ok: false, reason: "cooldown", warnCount };
  }
  return { ok: true, warnCount };
}

export function isBlockedMassAction(text) {
  const q = String(text || "").toLowerCase();
  return /\b(mass\s*ban|ban\s+all|wipe\s+claims?|vote\s*weight)\b/.test(q);
}

/** Economy / core-plugin / permissions — proposal-gated (not silent self-evo). */
export function isBlockedEconomyOrCore(text) {
  const q = String(text || "").toLowerCase();
  return /\b(economy\s+rate|change\s+(the\s+)?(tax|interest|shop\s+price)|permissions?\s+node|luckperms|core\s+plugin)\b/.test(
    q,
  );
}

/**
 * Operator mod commands (Alex / staff with emergency-stop power):
 *   Ava warn @user reason…
 *   Ava mute @user reason…
 *   Ava ban-check @user
 * Ban execute only if dual-signal + not admin — still posts propose, doesn't auto-ban unless AVA_MOD_EXECUTE=1
 */
export async function tryModerationCommand({ fetchJson, msg, channelId, reply }) {
  const content = String(msg?.content || "");
  if (!/\bava\b/i.test(content)) return { handled: false };
  if (!canEmergencyStop(msg.author?.id, msg.author?.username)) {
    // Only operators/staff run mod commands through Ava
    if (!/\b(warn|mute|ban-check|timeout)\b/i.test(content)) return { handled: false };
    // Non-operators: ignore as mod command (may still be normal chat)
    if (!/^(hey\s+|hi\s+)?ava\s+(warn|mute|ban-check|timeout)\b/i.test(content.trim())) {
      return { handled: false };
    }
    await reply(channelId, "Only operators can run mod commands through me.", msg.id);
    return { handled: true };
  }

  const m = content.match(
    /\bava\s+(warn|mute|timeout|ban-check)\s+<@!?(\d+)>\s*(.*)$/i,
  );
  if (!m) return { handled: false };

  const kind = m[1].toLowerCase();
  const targetId = m[2];
  const reason = (m[3] || "").trim() || "no reason given";

  if (isAdminProtected(targetId)) {
    await reply(channelId, "Admins are protected — I never ban/mute staff.", msg.id);
    return { handled: true };
  }

  if (kind === "ban-check") {
    const gate = canProposeBan(targetId);
    await reply(
      channelId,
      gate.ok
        ? `Ban gate OK for <@${targetId}> (${gate.warnCount} signals). Dual-signal + cooldown cleared.`
        : `Ban gate blocked: ${gate.reason}${gate.warnCount != null ? ` (signals=${gate.warnCount})` : ""}.`,
      msg.id,
    );
    return { handled: true };
  }

  const signalKind = kind === "timeout" ? "mute" : kind;
  const rec = recordModSignal(targetId, {
    kind: signalKind,
    by: msg.author?.id,
    reason,
  });
  if (!rec.ok) {
    await reply(channelId, `Couldn't record signal: ${rec.reason}`, msg.id);
    return { handled: true };
  }

  // Optional Discord timeout (mute) when enabled
  if (
    (kind === "mute" || kind === "timeout") &&
    String(process.env.AVA_MOD_EXECUTE || "").trim() === "1" &&
    fetchJson
  ) {
    try {
      const until = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await fetchJson(`/guilds/${msg.guild_id}/members/${targetId}`, {
        method: "PATCH",
        body: JSON.stringify({ communication_disabled_until: until }),
      });
      await reply(
        channelId,
        `Recorded **${signalKind}** + applied 10m timeout. Reason: ${reason.slice(0, 120)}`,
        msg.id,
      );
      return { handled: true };
    } catch (err) {
      await reply(
        channelId,
        `Recorded **${signalKind}** but Discord timeout failed (${err.message}).`,
        msg.id,
      );
      return { handled: true };
    }
  }

  await reply(
    channelId,
    `Recorded **${signalKind}** on that player (silent score). Reason: ${reason.slice(0, 120)}`,
    msg.id,
  );
  return { handled: true };
}

export function gatherModerationBrief(targetId) {
  if (!targetId) return { brief: "" };
  const p = loadPlayerProfile(targetId);
  if (!p?.modSignals?.length) return { brief: "" };
  return {
    brief: `### Moderation signals (private)
target ${p.username}: ${(p.modSignals || []).slice(-5).map((s) => `${s.kind}@${s.at}`).join(", ")}
admin_protected: ${isAdminProtected(targetId)}`,
  };
}
