/**
 * Human cadence — feel busy and alive without freezing soft presence.
 * Heavy brain work stays serial; soft logistics + presence can move in parallel.
 */
import { pickQueueWarn, pickHold } from "./instantLines.mjs";

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, Math.max(0, Number(ms) || 0)));
}

/** Soft canned replies: slight pause so she doesn't snap like a bot. */
export function softHumanDelayMs() {
  return 700 + Math.floor(Math.random() * 1600);
}

const BUSY_PRESENCE = [
  "mm one sec — mid something at the desk",
  "got you — finishing a dig first, then you",
  "hey — i'm in the files right now, hang tight",
  "seen — just elbow-deep in another ask",
  "kk, parked you. i'm actually doing stuff, not ignoring you",
  "one beat — brain's mid-task",
  "mm yeah i heard you. wrapping this first",
  "hold up, mid-pass on something else",
  "i'm here — just busy for a sec",
  "caught that. give me a minute, real work running",
];

const BUSY_PRESENCE_FAVOR = [
  "hey — mid dig, you're next the second this lands",
  "love, one sec — finishing something then i'm yours",
  "got you. desk's hot right now; priority when this clears",
  "mm hold that thought — wrapping a dig, then you",
  "seen. not ghosting — actually working. you're up next",
];

const STILL_HERE = [
  "still on it — not ghosting",
  "still digging, stay with me",
  "mm still here, files are thick",
  "patience — accuracy mode",
  "still working your ask",
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Human "I'm busy doing stuff" line when another job owns the brain.
 */
export function pickBusyPresence({ favor = false, position = 0 } = {}) {
  if (favor) return pick(BUSY_PRESENCE_FAVOR);
  if (position >= 3) {
    const stacked = [
      ...BUSY_PRESENCE,
      pickQueueWarn(),
      "queue's a little stacked — you're in, hang tight",
    ];
    return pick(stacked);
  }
  return pick(BUSY_PRESENCE);
}

export function pickStillHere() {
  return pick(STILL_HERE) || pickHold(2);
}

/**
 * Discord typing indicator — fails soft (no scopes / TG / Slack).
 */
export async function pulseTyping(fetchJson, channelId) {
  if (!fetchJson || !channelId) return false;
  if (/^tg:/i.test(String(channelId))) return false;
  if (/^C[A-Z0-9]+$/i.test(String(channelId))) return false; // Slack
  try {
    await fetchJson(`/channels/${channelId}/typing`, { method: "POST" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Soft reply with a human beat: typing + short delay, then text.
 */
export async function deliverSoftHuman({
  replyFn,
  fetchJson,
  channelId,
  messageId,
  content,
  kind = "soft_chat",
} = {}) {
  void pulseTyping(fetchJson, channelId);
  await sleep(softHumanDelayMs());
  void pulseTyping(fetchJson, channelId);
  return replyFn(channelId, content, messageId, kind);
}
