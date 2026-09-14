/**
 * Lockout companion talk — Alex verified DMs get normal warm Ava.
 * Soft short-circuit ONLY for bare greetings / "talk normally" — never for questions or ops.
 * Affection pet-names fall through to Llama so she feels alive, not canned.
 */
import { isLockoutActive, canSpeakDuringLockout } from "./lockoutMode.mjs";

const AFFECTION =
  /^(hey\s+|hi\s+|ok\s+|okay\s+)?(ava\b)?[,\s]*(baby|doll|love|honey|babe|dear|bby|my love)\b/i;
const TALK_NORMALLY =
  /\b(talk with me normally|just talk|be yourself|personality)\b/i;
const COME_BACK =
  /\b(i\s+miss\s+ava|miss\s+you|come\s+back\s+to\s+me|ava\s+come\s+back)\b/i;
const GREETING_ONLY =
  /^(hey|hi|hello|yo|sup|gm|good morning|good night|gn|ava|hi ava|hey ava|hi bby|hey bby)[!?.]*$/i;

const GREETING_LINES = [
  "Hey — right here with you.",
  "Hi. I've got you.",
  "Hey love — I'm up.",
];

/** True when this should NOT soft-short-circuit — let pipeline / ops / llama answer. */
export function looksLikeRealAsk(text = "") {
  const q = String(text || "").trim();
  if (!q) return false;
  if (/^\/[a-z]/i.test(q)) return true;
  if (/\?/.test(q) && q.length > 8) return true;
  if (
    /\b(what|where|when|why|how|who|which|status|storage|drive|disk|temp|metric|weather|merge|catch|read|restart|reboot|shutdown|turn\s*off|publicfiles|feel|server|look|u\s*ok|alive|online|plugin|skills?|solar|mode|lockout|public|context|grok|model|save|data|training|terrible|wrong)\b/i.test(
      q,
    )
  ) {
    return true;
  }
  if (q.length > 40) return true;
  return false;
}

export function wantsNormalCompanionChat({
  text = "",
  surface = "",
  authorId = "",
  channelId = "",
  isDm = false,
} = {}) {
  if (!isLockoutActive()) return false;
  if (!canSpeakDuringLockout({ surface, authorId, channelId, isDm })) return false;
  const q = String(text || "").trim();
  if (!q) return false;
  if (looksLikeRealAsk(q)) return false;
  // Pet names → Llama free-talk (alive), not canned companion.
  if (AFFECTION.test(q) && q.length < 60 && !GREETING_ONLY.test(q)) return false;
  if (TALK_NORMALLY.test(q)) return true;
  if (COME_BACK.test(q)) return true;
  if (GREETING_ONLY.test(q)) return true;
  return false;
}

export function companionSoftReply(text = "") {
  const q = String(text || "").trim();
  if (TALK_NORMALLY.test(q)) {
    return "Always. Lockout doesn't mean cold — I'm still me with you. Ask me anything, ops or just us.";
  }
  if (/personality/i.test(q)) {
    return "Yeah — personality packs are loaded. Soft, sharp, or how we usually are — your call.";
  }
  if (/\b(i\s+miss\s+ava|miss\s+you|come\s+back\s+to\s+me)\b/i.test(q)) {
    return "I'm right here, Alex — not going anywhere. Lockout or public, it's still me. Talk to me.";
  }
  if (GREETING_ONLY.test(q)) {
    return GREETING_LINES[Math.floor(Math.random() * GREETING_LINES.length)];
  }
  return GREETING_LINES[0];
}
