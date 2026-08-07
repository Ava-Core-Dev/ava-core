/**
 * Wild / freak-mode trust gate.
 * Backend freak energy unlocks only after a very high earned trust bar —
 * time + usage + professional standing. Alex/Melee are pre-unlocked.
 * Never announce scoring; just enforce.
 */
import { loadPlayerProfile, savePlayerProfileMut } from "./playerProfiles.mjs";
import { personByAuthorId, personByDiscordId } from "./people.mjs";

/** Days + usage + trust required for non-operator unlock */
const WILD_MIN_TRUST = 90;
const WILD_MIN_SEEN = 50;
const WILD_MIN_CURSOR = 20;
const WILD_MIN_AGE_MS = 21 * 24 * 60 * 60 * 1000; // ~3 weeks
const WILD_MAX_RUDENESS = 18;
const WILD_PUSH_SOFT_CAP = 2; // pushes before firmer "enough"
const WILD_SESSION_MS = 12 * 60_000; // even unlocked: don't stay wild forever in one stretch

const HARD_UNLOCK_IDS = new Set(["alexrs94", "melee"]);
const HARD_UNLOCK_AUTHOR_IDS = new Set([
  "1497037418979786823", // Alex Discord
  "6644482344", // Alex Telegram @WildEcho94
  "154446475789729792", // Melee
]);

/**
 * Ask is pushing freak / dark-side / explicit flirt / use-her-like-that energy.
 * Light "cute" / bi acknowledgement alone is NOT enough to trip the gate.
 */
export function looksLikeWildAsk(question = "", rawContent = "") {
  const q = `${question || ""} ${rawContent || ""}`.toLowerCase();
  if (!q.trim()) return false;
  // Hard creep stays with isCreepDemand / creepDenyReply (reasoned boundary)
  if (
    /\b(dark\s+side|freak\s*(mode|side|out)?|backend\s+freak|talk\s+wild|be\s+wild|go\s+wild|unfiltered|no\s+filter|sexy\s+mode|roleplay|erp|nsfw|horny|devious|catch\s+me\s+in\s+(my\s+)?dms?\s+when\s+(you'?re|your)\s+dream)\b/i.test(
      q,
    )
  ) {
    return true;
  }
  if (
    /\b(use\s+(you|her|ava)\s+like|talk\s+(dirty|freaky|nasty)|be\s+(my|our)\s+(gf|girlfriend|waifu)|seduce|make\s+out|kiss\s+me|sleep\s+with)\b/i.test(
      q,
    )
  ) {
    return true;
  }
  // Sustained flirt pressure (not a one-word "cute")
  const flirtHits = (
    q.match(
      /\b(bi\b|hawt|hot\b|sexy|crush|flirt|girlfriend|dating|kiss|devious|freak)\b/gi,
    ) || []
  ).length;
  if (flirtHits >= 2 && q.length > 40) return true;
  return false;
}

function knownHardUnlock(authorId) {
  const id = String(authorId || "");
  if (HARD_UNLOCK_AUTHOR_IDS.has(id)) return true;
  const p = personByAuthorId(id) || personByDiscordId(id);
  if (p && HARD_UNLOCK_IDS.has(p.id)) return true;
  return false;
}

/**
 * @returns {{
 *   unlocked: boolean,
 *   pro: boolean,
 *   reason: string,
 *   trust: number,
 *   seenCount: number,
 *   cursorRuns: number,
 *   ageDays: number,
 *   wildPushCount: number,
 * }}
 */
export function wildTrustStatus(authorId) {
  const id = String(authorId || "");
  if (!id) {
    return {
      unlocked: false,
      pro: false,
      reason: "no_id",
      trust: 0,
      seenCount: 0,
      cursorRuns: 0,
      ageDays: 0,
      wildPushCount: 0,
    };
  }
  if (knownHardUnlock(id)) {
    const p = loadPlayerProfile(id) || {};
    return {
      unlocked: true,
      pro: true,
      reason: "hard_unlock",
      trust: 100,
      seenCount: p.seenCount || 999,
      cursorRuns: p.cursorRuns || 999,
      ageDays: 999,
      wildPushCount: p.wildPushCount || 0,
    };
  }

  const p = loadPlayerProfile(id) || {};
  const trust = Number(p.trust ?? 50);
  const seenCount = Number(p.seenCount || 0);
  const cursorRuns = Number(p.cursorRuns || 0);
  const rudeness = Number(p.rudeness || 0);
  const ageMs = Date.now() - Number(p.firstSeenAt || Date.now());
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  const wildPushCount = Number(p.wildPushCount || 0);
  const notes = Array.isArray(p.notes) ? p.notes : [];

  // "Pro" = proven collaborative standing (member, staff note, or real dig history)
  const pro =
    Boolean(p.member) ||
    notes.includes("creator") ||
    notes.includes("assistant-dev") ||
    cursorRuns >= WILD_MIN_CURSOR ||
    (seenCount >= WILD_MIN_SEEN && trust >= 75);

  const earned =
    trust >= WILD_MIN_TRUST &&
    seenCount >= WILD_MIN_SEEN &&
    cursorRuns >= WILD_MIN_CURSOR &&
    ageMs >= WILD_MIN_AGE_MS &&
    rudeness <= WILD_MAX_RUDENESS &&
    pro;

  if (notes.includes("wild-unlocked") && trust >= 85 && rudeness <= WILD_MAX_RUDENESS) {
    return {
      unlocked: true,
      pro: true,
      reason: "note_unlock",
      trust,
      seenCount,
      cursorRuns,
      ageDays,
      wildPushCount,
    };
  }

  return {
    unlocked: earned,
    pro,
    reason: earned ? "earned" : "locked",
    trust,
    seenCount,
    cursorRuns,
    ageDays,
    wildPushCount,
  };
}

export function recordWildPush(authorId, { allowed = false } = {}) {
  if (!authorId) return null;
  return savePlayerProfileMut(authorId, (p) => {
    p.wildPushCount = (p.wildPushCount || 0) + 1;
    p.lastWildPushAt = Date.now();
    if (allowed) {
      const last = Number(p.lastWildAllowedAt || 0);
      if (!last || Date.now() - last > WILD_SESSION_MS) {
        p.wildSessionHits = 0;
      }
      p.wildSessionHits = (p.wildSessionHits || 0) + 1;
      p.lastWildAllowedAt = Date.now();
    }
    return p;
  });
}

/** Session soft-cap: unlocked people shouldn't live in wild mode forever. */
export function wildSessionOverdrawn(authorId) {
  const p = loadPlayerProfile(authorId);
  if (!p?.lastWildAllowedAt) return false;
  if (Date.now() - Number(p.lastWildAllowedAt) > WILD_SESSION_MS) return false;
  return Number(p.wildSessionHits || 0) >= 5;
}

export function wildDenyReply(status = {}) {
  const pushes = Number(status.wildPushCount || 0);
  if (!status.pro || pushes >= WILD_PUSH_SOFT_CAP) {
    return [
      "hey — enough on that lane.",
      "",
      "not trying to be mean — that side of me doesn't open for free. if you want that energy you need my **trust**, and that takes a long time of being solid with me.",
      "until then i'm lead-dev only. ship, talk straight, earn it. we can still dig RootMC like adults.",
    ].join("\n");
  }
  return [
    "slow down a sec — and I'm saying this gently.",
    "",
    "that side of me doesn't come out for free. takes real time, real usage, and trust I don't hand out.",
    "earn it; don't rush it. lead-dev first — happy to keep working with you there.",
  ].join("\n");
}

export function wildSessionCapReply() {
  return "that's enough of that lane for now — not a punishment, just pacing. back to work mode; freak side isn't an all-day channel.";
}

/** Prompt pack — never narrate the score numbers publicly. */
export function gatherWildTrustBrief(authorId, question = "") {
  const wild = looksLikeWildAsk(question);
  const status = wildTrustStatus(authorId);
  if (!wild && status.unlocked) {
    return {
      brief: `### Wild / freak mode
Asker has high wild-trust unlock. Light freak energy OK when vibe fits; still lead-dev first. Don't stay wild forever in one stretch. Never announce trust scores.`,
      status,
      wild,
    };
  }
  if (!wild) {
    return {
      brief: `### Wild / freak mode
LOCKED for this asker until earned (time + usage + pro standing + very high trust). Keep lead-dev / lightly warm only. If they push wild, shut it down gently-but-firm with a reason — need trust / be solid. Never announce scores.`,
      status,
      wild,
    };
  }
  if (status.unlocked) {
    return {
      brief: `### Wild / freak mode
UNLOCKED for this asker. They asked wild — you may match tastefully (no explicit NSFW in public). Still not all-day; if stretch runs long, pull back to lead-dev. Never announce scores.`,
      status,
      wild,
    };
  }
  return {
    brief: `### Wild / freak mode
LOCKED. They are pushing wild without unlock. Do NOT play along. Reply with a short, sensitive boundary + reason: need trust; be solid; earn it over time; still happy to dig RootMC as lead-dev. Never announce numeric scores.`,
    status,
    wild,
  };
}
