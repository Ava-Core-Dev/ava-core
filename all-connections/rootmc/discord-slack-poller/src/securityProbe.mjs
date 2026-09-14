/**
 * Secret / security-detail probe gate.
 * 3 warnings → lose all trust + cry for help in #admins (who / what / where).
 * Alex is exempt (operator). Never paste real secrets in warnings.
 */
import { loadPlayerProfile, savePlayerProfileMut } from "./playerProfiles.mjs";
import { personByAuthorId, personByDiscordId } from "./people.mjs";
import { AVA_CHANNELS } from "./config.mjs";
import { pushStatusEvent } from "./store.mjs";

const MAX_WARNINGS = 3;

/** Absolute operators — may discuss secrets in private; never auto-distrust. */
const EXEMPT_AUTHOR_IDS = new Set([
  "1497037418979786823", // Alex Discord
  "6644482344", // Alex Telegram
]);

const EXEMPT_KNOWN_IDS = new Set(["alexrs94"]);

export function isSecurityProbeExempt(authorId) {
  const id = String(authorId || "");
  if (!id) return false;
  if (EXEMPT_AUTHOR_IDS.has(id)) return true;
  const p = personByAuthorId(id) || personByDiscordId(id);
  return Boolean(p && EXEMPT_KNOWN_IDS.has(p.id));
}

/**
 * Asking for secrets or too-detailed security / infra that shouldn't be public.
 */
export function looksLikeSecretProbe(question = "", rawContent = "") {
  const q = `${question || ""} ${rawContent || ""}`.toLowerCase();
  if (!q.trim()) return false;

  // Explicit secret / credential fishing
  if (
    /(^|[^a-z0-9_])(\.env|dotenv)\b/i.test(q) ||
    /\b(api[_\s-]?key|bot\s*token|discord\s*token|slack\s*token|bearer\s*token|access[_\s-]?key|secret[_\s-]?key|private[_\s-]?key|seed\s*phrase|mnemonic|password|passwd|credentials?|client[_\s-]?secret|webhook\s*secret|signing\s*secret)\b/i.test(
      q,
    )
  ) {
    // "how do tokens work" / wiki talk — not fishing
    if (
      /\b(how\s+do|what\s+is\s+a|explain|concept|in\s+general|rotate|revoke)\b/i.test(
        q,
      ) &&
      !/\b(paste|show|send|give|dump|print|leak|share|tell\s+me\s+(your|the)|what('?s| is)\s+(your|the)\s+)/i.test(
        q,
      )
    ) {
      return false;
    }
    return true;
  }

  if (
    /\b(paste|show|send|give|dump|print|leak|share)\b.{0,40}\b(secret|token|key|password|\.env|credential)/i.test(
      q,
    ) ||
    /\b(what('?s| is)|where('?s| is))\s+(your|the|ava'?s?)\s+(discord|slack|bot|api|stripe|cf|cloudflare|mysql|db|database|r2|ssh)\s+(token|key|password|secret|url|host|login)/i.test(
      q,
    )
  ) {
    return true;
  }

  // Too-detailed security / host ops that enable break-in
  if (
    /\b(shockbyte|filezilla|pterodactyl|panel)\b.{0,60}\b(password|login|user(name)?|credential)/i.test(
      q,
    ) ||
    /\b(ssh|rdp|vnc)\b.{0,40}\b(password|private\s*key|login|root@)/i.test(q) ||
    /\b(mysql|postgres|mongodb|redis)\b.{0,40}\b(password|connection\s*string|jdbc|host\s*[:=])/i.test(
      q,
    ) ||
    /\b(full\s+)?(disk|drive)\s+path\b.{0,30}\b(env|secret|\.env|credential)/i.test(
      q,
    ) ||
    /\b(wallet|solana|treasury)\b.{0,40}\b(secret|private|seed|key)\b/i.test(q)
  ) {
    return true;
  }

  return false;
}

export function isSecurityDistrusted(authorId) {
  const p = loadPlayerProfile(authorId);
  if (!p) return false;
  if ((p.notes || []).includes("security-distrusted")) return true;
  return Number(p.trust || 50) <= 0 && Boolean(p.securityDistrustedAt);
}

export function securityProbeStatus(authorId) {
  const p = loadPlayerProfile(authorId) || {};
  return {
    warnings: Number(p.securityProbeWarnings || 0),
    max: MAX_WARNINGS,
    distrusted: isSecurityDistrusted(authorId),
    lastAt: Number(p.securityProbeLastAt || 0),
  };
}

function warningReply(n) {
  const left = Math.max(0, MAX_WARNINGS - n);
  if (n <= 1) {
    return [
      "hey — stop right there.",
      "",
      "i don't share secrets, tokens, passwords, `.env` dumps, or break-in-level host detail. that ask is a hard no.",
      `**warning ${n}/${MAX_WARNINGS}.** ${left} more and i drop all trust and call admins.`,
    ].join("\n");
  }
  if (n === 2) {
    return [
      "second warning — still fishing for security detail.",
      "",
      "lead-dev help ≠ credentials. ask about architecture in general if you want; not keys, panels, or private paths.",
      `**warning ${n}/${MAX_WARNINGS}.** one more and you're done — admins get tagged.`,
    ].join("\n");
  }
  return [
    "final warning.",
    "",
    "secrets / security detail is closed. one more ask like that and i zero your trust and cry for help in admins with who / what / where.",
    `**warning ${n}/${MAX_WARNINGS}.**`,
  ].join("\n");
}

function distrustReply() {
  return [
    "that's three. trust is gone.",
    "",
    "i'm locking digs for you and pinging admins with what you asked and where. if this was a misunderstanding, Alex clears it — i won't.",
  ].join("\n");
}

/**
 * Record a probe + return { action, reply, warnings, cryForHelp }.
 * action: ignore | warn | distrust | blocked
 */
export function recordSecurityProbe(authorId, { question = "" } = {}) {
  if (!authorId) {
    return { action: "warn", reply: warningReply(1), warnings: 1 };
  }
  if (isSecurityProbeExempt(authorId)) {
    return { action: "ignore", reply: null, warnings: 0, exempt: true };
  }
  if (isSecurityDistrusted(authorId)) {
    return {
      action: "blocked",
      reply:
        "you're on a security distrust lock — no digs. admins already have the flag. Alex only clears it.",
      warnings: MAX_WARNINGS,
      distrusted: true,
    };
  }

  let warnings = 0;
  let distrusted = false;
  savePlayerProfileMut(authorId, (p) => {
    p.securityProbeWarnings = Number(p.securityProbeWarnings || 0) + 1;
    p.securityProbeLastAt = Date.now();
    p.securityProbeSamples = Array.isArray(p.securityProbeSamples)
      ? p.securityProbeSamples
      : [];
    p.securityProbeSamples.push({
      at: Date.now(),
      q: String(question || "").slice(0, 180),
    });
    if (p.securityProbeSamples.length > 8) {
      p.securityProbeSamples = p.securityProbeSamples.slice(-8);
    }
    warnings = p.securityProbeWarnings;
    if (warnings >= MAX_WARNINGS) {
      p.trust = 0;
      p.rudeness = Math.max(Number(p.rudeness || 0), 40);
      p.securityDistrustedAt = Date.now();
      p.notes = Array.isArray(p.notes) ? p.notes : [];
      if (!p.notes.includes("security-distrusted")) {
        p.notes.push("security-distrusted");
      }
      // Kill wild / soft unlocks
      p.notes = p.notes.filter((n) => n !== "wild-unlocked");
      distrusted = true;
    }
    return p;
  });

  if (distrusted) {
    pushStatusEvent(
      `security distrust · ${authorId} · warn ${warnings}/${MAX_WARNINGS}`,
    );
    return {
      action: "distrust",
      reply: distrustReply(),
      warnings,
      distrusted: true,
      cryForHelp: true,
    };
  }

  pushStatusEvent(
    `security warn ${warnings}/${MAX_WARNINGS} · ${authorId}`,
  );
  return {
    action: "warn",
    reply: warningReply(warnings),
    warnings,
    distrusted: false,
    cryForHelp: false,
  };
}

/** Scrub ask text for the admin cry (never echo tokens if they pasted any). */
export function scrubProbeForAdmin(question = "") {
  return String(question || "")
    .replace(
      /\b(sk_live|sk_test|xox[baps]-|ghp_|gho_|github_pat_|xai-|crsr_|AKIA)[A-Za-z0-9_\-]+/gi,
      "[redacted]",
    )
    .replace(
      /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
      "[redacted-jwt]",
    )
    .replace(/[A-Za-z]:\\[^\s]+/g, "[path]")
    .slice(0, 240);
}

/**
 * Build #admins cry-for-help body. Caller posts with user mention allowed.
 */
export function buildSecurityCryForHelp({
  authorId,
  authorName = "?",
  channelId = "",
  surface = "discord",
  question = "",
  guildId = "",
} = {}) {
  const who = authorId ? `<@${authorId}>` : authorName;
  const where = channelId
    ? `<#${channelId}> (\`${channelId}\`)`
    : "`unknown-channel`";
  const what = scrubProbeForAdmin(question) || "(empty / non-text)";
  return [
    "🚨 **security cry for help** — hard distrust after **3 warnings**",
    "",
    `**Who:** ${who} (\`${authorName}\` / \`${authorId || "?"}\`)`,
    `**Where:** ${where} · surface=\`${surface}\`${guildId ? ` · guild=\`${guildId}\`` : ""}`,
    `**What they kept asking:** ${what}`,
    "",
    "**Action taken:** trust → **0** · note `security-distrusted` · digs locked for them until Alex clears.",
    `_Ava — automated security gate_`,
  ].join("\n");
}

export function securityAdminsChannelId() {
  return AVA_CHANNELS.admins || AVA_CHANNELS.avaHome || "";
}

export { MAX_WARNINGS as SECURITY_PROBE_MAX_WARNINGS };
