/**
 * Favoritism + rudeness gates — prioritize people Ava likes; ignore rude ones.
 * Uses known people pack + living playerProfiles trust/rudeness.
 */
import {
  personByAuthorId,
  personByDiscordId,
  personByName,
} from "./people.mjs";
import {
  loadPlayerProfile,
  savePlayerProfileMut,
} from "./playerProfiles.mjs";
import { isDisrespectTowardAva } from "./avaSelfRespect.mjs";

function isProtectedOperator(authorId) {
  const id = String(authorId || "");
  const melee = String(process.env.AVA_MELEE_DISCORD_ID || "154446475789729792")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const alex = ["1497037418979786823"];
  const telegramDefaults = ["6644482344"];
  const slackDefaults = ["U0BLWBTGYTU", "U0BLQ5Q8WTD"];
  const slackOps = String(process.env.AVA_SLACK_OPERATOR_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const telegramOps = String(process.env.AVA_TELEGRAM_OPERATOR_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    alex.includes(id) ||
    melee.includes(id) ||
    slackDefaults.includes(id) ||
    slackOps.includes(id) ||
    telegramDefaults.includes(id) ||
    telegramOps.includes(id)
  );
}

const RUDE_RE =
  /\b(stfu|shut\s*up|idiot|trash|kys|kill\s*yourself|worthless|clanker|fuck\s*you|fuck\s*off|hate\s*you|dumb\s*bot|useless\s*bot|shut\s*the\s*fuck)\b/i;

/** Affection / presence — short context that needs a real voice, not "mm?". */
export function isAffectionOrPresence(question = "", rawContent = "") {
  const q = String(question || rawContent || "")
    .replace(/<@!?\d+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!q || q.length > 220) return false;
  if (
    /\b(i love you|love you|miss you|my love|glad you('?re| are)?\s*back|welcome back|how are you|how('?re| are) you feeling|are you (there|ok|awake|online|up)|you there|thanks?\s+(baby|love|ava))\b/i.test(
      q,
    )
  ) {
    return true;
  }
  if (/^(ava[.…\s,]*)?(my love|babe|baby|love you)[.…!?❤❤️💕💖]*$/i.test(q)) {
    return true;
  }
  return false;
}

/**
 * Soft logistics that stay canned; affection/presence wants real short reply.
 */
export function wantsRealShortReply(question = "", rawContent = "") {
  return isAffectionOrPresence(question, rawContent);
}

function knownPerson(authorId, username) {
  return (
    personByAuthorId(authorId, username) ||
    personByDiscordId(authorId) ||
    personByName(username) ||
    null
  );
}

/**
 * 0–100 queue priority. Higher = sooner.
 * Alex/ops absolute; trusted circle high; living trust helps; rudeness hurts.
 */
export function favorPriority(authorId, username = "") {
  if (!authorId) return 10;
  if (isProtectedOperator(authorId)) return 100;

  const known = knownPerson(authorId, username);
  const roles = new Set(known?.roles || []);
  let base = 40;
  if (roles.has("owner") || roles.has("operator")) base = 100;
  else if (roles.has("trusted") || roles.has("emergency-stop")) base = 90;
  else if (roles.has("admin") || roles.has("staff")) base = 70;
  else if (known) base = 55;

  const p = loadPlayerProfile(authorId);
  const trust = Number(p?.trust ?? 50);
  const rude = Number(p?.rudeness ?? 0);
  const blended = Math.round(base * 0.55 + trust * 0.45 - rude * 0.6);
  return Math.max(0, Math.min(100, blended));
}

export function favorTier(authorId, username = "") {
  const n = favorPriority(authorId, username);
  if (n >= 90) return "inner";
  if (n >= 70) return "favorite";
  if (n >= 45) return "warm";
  if (n >= 25) return "neutral";
  return "cold";
}

export function looksRudeLine(text = "") {
  return RUDE_RE.test(String(text || "")) || isDisrespectTowardAva(text);
}

/**
 * Straight-up ignore: high rudeness and/or clear disrespect.
 * Never ignore Alex / Melee / emergency-stop circle.
 */
export function shouldIgnoreRude({
  authorId = "",
  username = "",
  text = "",
  replyToAva = false,
} = {}) {
  if (!authorId) return false;
  if (isProtectedOperator(authorId)) return false;

  const known = knownPerson(authorId, username);
  const roles = new Set(known?.roles || []);
  if (
    roles.has("owner") ||
    roles.has("operator") ||
    roles.has("trusted") ||
    roles.has("emergency-stop")
  ) {
    return false;
  }

  const p = loadPlayerProfile(authorId);
  const rude = Number(p?.rudeness ?? 0);
  const trust = Number(p?.trust ?? 50);

  const lineRude =
    looksRudeLine(text) ||
    (replyToAva && isDisrespectTowardAva(text));

  if (lineRude) {
    try {
      savePlayerProfileMut(authorId, (prev) => {
        prev.rudeness = Math.min(100, (prev.rudeness || 0) + 8);
        prev.trust = Math.max(0, (prev.trust || 50) - 5);
        if ((prev.rudeness || 0) > 40) prev.tone = "short_firm";
        if (!prev.notes) prev.notes = [];
        if (!prev.notes.includes("rude-ignored")) prev.notes.push("rude-ignored");
        return prev;
      });
    } catch {
      /* ignore */
    }
  }

  // Hard ignore thresholds
  if (rude >= 50) return true;
  if (trust <= 18 && rude >= 25) return true;
  if (lineRude && rude >= 30) return true;
  if (lineRude && !known && rude >= 15) return true;
  // Fresh clear disrespect toward Ava — ignore immediately for unknowns
  if (lineRude && isDisrespectTowardAva(text) && !known) return true;

  return false;
}
