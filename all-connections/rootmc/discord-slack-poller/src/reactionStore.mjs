import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import {
  lookupStandardSignal,
  normalizeEmojiKey,
} from "./emojiSignals.mjs";

/**
 * Reaction feedback on Ava's messages — silent training / quality data.
 * Known standard emojis are pre-assigned. Unknowns: ask once, learn, never spam.
 */

function reactionsDir() {
  const dir = path.join(storePaths().dir, "reactions");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "messages"), { recursive: true });
  return dir;
}

function summaryPath() {
  return path.join(reactionsDir(), "summary.json");
}

function learnedPath() {
  return path.join(reactionsDir(), "learned.json");
}

function pendingAsksPath() {
  return path.join(reactionsDir(), "pending-asks.json");
}

function messagePath(messageId) {
  return path.join(reactionsDir(), "messages", `${messageId}.json`);
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

/** @deprecated use resolveReaction — kept for callers that expect REACTION_MAP */
export const REACTION_MAP = {};

export function loadLearned() {
  return readJson(learnedPath(), { byKey: {}, updatedAt: 0 });
}

export function saveLearned(data) {
  data.updatedAt = Date.now();
  writeJson(learnedPath(), data);
}

export function loadPendingAsks() {
  return readJson(pendingAsksPath(), { pending: {}, asked: {}, updatedAt: 0 });
}

export function savePendingAsks(data) {
  data.updatedAt = Date.now();
  writeJson(pendingAsksPath(), data);
}

/**
 * Stable key for an emoji reaction.
 * Unicode → normalized glyph; custom → name:id
 */
export function emojiStorageKey(emoji) {
  if (!emoji) return "?";
  if (emoji.id) return `${emoji.name || "custom"}:${emoji.id}`;
  return normalizeEmojiKey(emoji.name || "") || String(emoji.name || "?");
}

export function emojiDisplay(emoji) {
  if (!emoji) return "?";
  if (emoji.id) return `:${emoji.name}:`;
  return emoji.name || "?";
}

/** Discord reaction path segment (unicode or name:id). */
export function emojiApiParam(emoji) {
  if (!emoji) return "";
  if (emoji.id) return `${emoji.name}:${emoji.id}`;
  return emoji.name || "";
}

/**
 * @returns {{ signal: 'good'|'bad'|'neutral', known: boolean, source: string }}
 */
export function resolveReaction(emojiOrName) {
  const raw =
    typeof emojiOrName === "object" && emojiOrName
      ? emojiOrName.name || ""
      : String(emojiOrName || "");
  const key =
    typeof emojiOrName === "object" && emojiOrName
      ? emojiStorageKey(emojiOrName)
      : normalizeEmojiKey(raw) || raw;

  const learned = loadLearned().byKey || {};
  if (learned[key]?.signal) {
    return { signal: learned[key].signal, known: true, source: "learned", key };
  }
  if (raw && learned[raw]?.signal) {
    return { signal: learned[raw].signal, known: true, source: "learned", key };
  }

  const standard = lookupStandardSignal(raw) || lookupStandardSignal(key);
  if (standard) {
    return { signal: standard, known: true, source: "standard", key };
  }

  // Custom emoji name heuristics (still "known" — no ask)
  const n = String(raw || key).toLowerCase();
  if (/thumbsup|heart|love|fire|check|clap|star|good|nice|based|pog|pepehappy/.test(n)) {
    return { signal: "good", known: true, source: "custom-heuristic", key };
  }
  if (/thumbsdown|cross|nope|bad|cringe|trash|mid|pepeangry|pepesad/.test(n)) {
    return { signal: "bad", known: true, source: "custom-heuristic", key };
  }

  return { signal: "neutral", known: false, source: "unknown", key };
}

export function classifyReaction(emojiName) {
  return resolveReaction(emojiName).signal;
}

export function learnEmoji(key, signal, meta = {}) {
  const sig = String(signal || "").toLowerCase();
  if (!["good", "bad", "neutral"].includes(sig)) return null;
  const data = loadLearned();
  data.byKey[key] = {
    signal: sig,
    taughtBy: meta.taughtBy || null,
    taughtByName: meta.taughtByName || null,
    rawText: meta.rawText ? String(meta.rawText).slice(0, 200) : null,
    display: meta.display || key,
    learnedAt: Date.now(),
  };
  saveLearned(data);

  const asks = loadPendingAsks();
  delete asks.pending[key];
  asks.asked[key] = true;
  savePendingAsks(asks);

  return data.byKey[key];
}

/** Parse good/bad/neutral from a short teaching reply. */
export function parseSignalFromText(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return null;
  if (/^(good|positive|like|👍|yes|yep|yeah|love|based)\b/.test(t)) return "good";
  if (/^(bad|negative|dislike|👎|nope|no|hate|cringe|trash|mid)\b/.test(t)) return "bad";
  if (/^(neutral|meh|idk|whatever|eh|mid-ok|neither)\b/.test(t)) return "neutral";
  if (/\b(means?\s+)?good\b/.test(t) || /\bpositive\b/.test(t) || /\blike\b/.test(t))
    return "good";
  if (/\b(means?\s+)?bad\b/.test(t) || /\bnegative\b/.test(t) || /\bdislike\b/.test(t))
    return "bad";
  if (/\b(means?\s+)?neutral\b/.test(t) || /\bmeh\b/.test(t)) return "neutral";
  return null;
}

/**
 * If this message teaches an emoji meaning (reply to ask, or emoji + signal), learn it.
 * @returns {{ learned: object, key: string, signal: string, thank: string } | null}
 */
export function tryLearnFromMessage(msg) {
  if (!msg?.content || msg.author?.bot) return null;
  const asks = loadPendingAsks();
  const pending = asks.pending || {};
  const signal = parseSignalFromText(msg.content);
  if (!signal) return null;

  const refId = msg.message_reference?.message_id;
  let hitKey = null;
  for (const [key, p] of Object.entries(pending)) {
    if (refId && String(p.askMessageId) === String(refId)) {
      hitKey = key;
      break;
    }
    if (
      String(p.askedUserId) === String(msg.author.id) &&
      String(p.channelId) === String(msg.channel_id || msg.channelId || "")
    ) {
      // same user in channel answering without strict reply — only if one pending for them
      if (!hitKey) hitKey = key;
      else if (hitKey !== key) {
        // ambiguous — require reply-to
        hitKey = null;
        break;
      }
    }
  }

  // "🫠 means good" — content includes a pending unicode glyph or :custom:
  if (!hitKey) {
    for (const [key, p] of Object.entries(pending)) {
      if (!key.includes(":") && msg.content.includes(key)) {
        hitKey = key;
        break;
      }
      const customName = key.includes(":") ? key.split(":")[0] : null;
      if (
        customName &&
        msg.content.toLowerCase().includes(`:${customName.toLowerCase()}:`)
      ) {
        hitKey = key;
        break;
      }
      if (p.display && p.display !== key && msg.content.includes(p.display)) {
        hitKey = key;
        break;
      }
    }
  }

  if (!hitKey || !pending[hitKey]) return null;

  const p = pending[hitKey];
  const learned = learnEmoji(hitKey, signal, {
    taughtBy: msg.author.id,
    taughtByName: msg.author.username,
    rawText: msg.content,
    display: p.display || hitKey,
  });
  const display = p.display || hitKey;
  return {
    learned,
    key: hitKey,
    signal,
    thank: `got it — locking ${display} as **${signal}**. thanks.`,
  };
}

export function buildEmojiAskLine({ display, username }) {
  const who = username ? `${username} — ` : "";
  return `${who}first time I've seen ${display} on my stuff. is that **good**, **bad**, or **neutral** for you? just reply which — helps me learn.`;
}

/**
 * Mark that we asked (or skip-ask) so we don't spam.
 */
export function markEmojiAsked(key, pendingRec) {
  const asks = loadPendingAsks();
  asks.asked[key] = true;
  if (pendingRec) asks.pending[key] = pendingRec;
  savePendingAsks(asks);
}

export function shouldAskAboutEmoji(key) {
  const asks = loadPendingAsks();
  if (asks.asked[key] || asks.pending[key]) return false;
  const learned = loadLearned().byKey || {};
  if (learned[key]) return false;
  return true;
}

function emptySummary() {
  return {
    totalReactions: 0,
    good: 0,
    bad: 0,
    neutral: 0,
    byEmoji: {},
    messagesTracked: 0,
    updatedAt: 0,
  };
}

export function loadReactionSummary() {
  return readJson(summaryPath(), emptySummary());
}

/** Rebuild summary + good-examples from on-disk message reaction files. */
export function refreshReactionDerived() {
  return rebuildSummaryFromDisk();
}

function rebuildSummaryFromDisk() {
  const dir = path.join(reactionsDir(), "messages");
  const summary = emptySummary();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    files = [];
  }
  for (const f of files) {
    const rec = readJson(path.join(dir, f), null);
    if (!rec?.totals) continue;
    summary.messagesTracked += 1;
    summary.good += rec.totals.good || 0;
    summary.bad += rec.totals.bad || 0;
    summary.neutral += rec.totals.neutral || 0;
    summary.totalReactions += rec.totals.all || 0;
    for (const [emoji, count] of Object.entries(rec.byEmoji || {})) {
      summary.byEmoji[emoji] = (summary.byEmoji[emoji] || 0) + count;
    }
  }
  summary.updatedAt = Date.now();
  writeJson(summaryPath(), summary);
  rebuildGoodExamplesFromDisk();
  return summary;
}

/** Common Slack short-names → Unicode for signal lookup. */
const SLACK_NAME_TO_UNICODE = {
  "+1": "👍",
  thumbsup: "👍",
  "-1": "👎",
  thumbsdown: "👎",
  heart: "❤",
  heavy_heart_exclamation: "❣️",
  fire: "🔥",
  "100": "💯",
  white_check_mark: "✅",
  heavy_check_mark: "✔️",
  x: "❌",
  clap: "👏",
  pray: "🙏",
  star: "⭐",
  sparkles: "✨",
  tada: "🎉",
  muscle: "💪",
  eyes: "👀",
  thinking_face: "🤔",
  joy: "😂",
  rolling_on_the_floor_laughing: "🤣",
  smile: "😄",
  heart_eyes: "😍",
  blush: "😊",
  cry: "😢",
  sob: "😭",
  rage: "😡",
  wave: "👋",
  ok_hand: "👌",
  raised_hands: "🙌",
  rocket: "🚀",
  warning: "⚠️",
  speech_balloon: "💬",
};

export function slackReactionToEmoji(name) {
  const n = String(name || "")
    .trim()
    .replace(/^:|:$/g, "")
    .toLowerCase();
  if (!n) return { name: "?", id: null };
  if (SLACK_NAME_TO_UNICODE[n]) {
    return { name: SLACK_NAME_TO_UNICODE[n], id: null };
  }
  // skin-tone variants: +1::skin-tone-2
  const base = n.split("::")[0];
  if (SLACK_NAME_TO_UNICODE[base]) {
    return { name: SLACK_NAME_TO_UNICODE[base], id: null };
  }
  return { name: n, id: null };
}

/**
 * Harvest reactions from a Discord message object (Ava's own posts only).
 */
export function ingestMessageReactions({
  message,
  channelId,
  avaBotId,
  surface = "discord",
  reactors = null,
}) {
  if (!message?.id) return { record: null, unknowns: [] };
  if (String(message.author?.id) !== String(avaBotId)) {
    return { record: null, unknowns: [] };
  }

  const reactions = Array.isArray(message.reactions) ? message.reactions : [];
  const byEmoji = {};
  const totals = { good: 0, bad: 0, neutral: 0, all: 0 };
  const unknowns = [];

  for (const r of reactions) {
    const emoji = r.emoji || {};
    const key = emojiStorageKey(emoji);
    const display = emojiDisplay(emoji);
    const count = Number(r.count || 0);
    if (count <= 0) continue;
    byEmoji[key] = count;
    const resolved = resolveReaction(emoji);
    totals[resolved.signal] += count;
    totals.all += count;
    if (!resolved.known && shouldAskAboutEmoji(key)) {
      unknowns.push({
        key,
        display,
        emoji,
        apiParam: emojiApiParam(emoji),
        messageId: message.id,
        channelId: channelId || message.channel_id || null,
        surface,
        count,
      });
    }
  }

  return persistReactionRecord({
    messageId: message.id,
    channelId: channelId || message.channel_id || null,
    contentPreview: String(message.content || "").slice(0, 240),
    byEmoji,
    totals,
    surface,
    unknowns,
    reactors,
  });
}

/**
 * Harvest reactions from a Slack message (Ava bot posts only).
 * Slack shape: { ts, text, user|bot_id, reactions: [{ name, count }] }
 */
export function ingestSlackMessageReactions({
  message,
  channelId,
  avaBotUserId,
  surface = "slack",
  reactors = null,
}) {
  if (!message?.ts) return { record: null, unknowns: [] };
  const isAva =
    message.__forceAva ||
    (avaBotUserId && String(message.user) === String(avaBotUserId)) ||
    (!message.user &&
      message.bot_id &&
      /—\s*Ava\b/i.test(String(message.text || "")));
  if (!isAva) return { record: null, unknowns: [] };

  const reactions = Array.isArray(message.reactions) ? message.reactions : [];
  const byEmoji = {};
  const totals = { good: 0, bad: 0, neutral: 0, all: 0 };
  const unknowns = [];
  /** @type {Record<string, object>} */
  let builtReactors = reactors;

  for (const r of reactions) {
    const emoji = slackReactionToEmoji(r.name);
    const key = emojiStorageKey(emoji);
    const display = emoji.id ? `:${emoji.name}:` : emoji.name || `:${r.name}:`;
    const count = Number(r.count || 0);
    if (count <= 0) continue;
    byEmoji[key] = (byEmoji[key] || 0) + count;
    const resolved = resolveReaction(emoji);
    totals[resolved.signal] += count;
    totals.all += count;

    // Slack history often includes users[] on each reaction
    if (Array.isArray(r.users) && r.users.length) {
      if (!builtReactors) builtReactors = {};
      for (const uid of r.users) {
        const id = String(uid || "");
        if (!id) continue;
        if (!builtReactors[id]) {
          builtReactors[id] = {
            userId: id,
            username: null,
            emojis: {},
            good: 0,
            bad: 0,
            neutral: 0,
          };
        }
        const row = builtReactors[id];
        if (!row.emojis[key]) {
          row.emojis[key] = { signal: resolved.signal, count: 0 };
          row[resolved.signal] = (row[resolved.signal] || 0) + 1;
        }
        row.emojis[key].count = (row.emojis[key].count || 0) + 1;
      }
    }

    if (!resolved.known && shouldAskAboutEmoji(key)) {
      unknowns.push({
        key,
        display,
        emoji,
        apiParam: r.name,
        messageId: message.ts,
        channelId: channelId || null,
        surface,
        count,
      });
    }
  }

  return persistReactionRecord({
    messageId: `slack-${String(message.ts)}`,
    channelId: channelId || null,
    contentPreview: String(message.text || "").slice(0, 240),
    byEmoji,
    totals,
    surface,
    unknowns,
    slackTs: message.ts,
    reactors: builtReactors,
  });
}

function persistReactionRecord({
  messageId,
  channelId,
  contentPreview,
  byEmoji,
  totals,
  surface,
  unknowns,
  slackTs = null,
  reactors = null,
}) {
  const prev = readJson(messagePath(messageId), null);
  const nextReactors =
    reactors && typeof reactors === "object"
      ? reactors
      : prev?.reactors && typeof prev.reactors === "object"
        ? prev.reactors
        : {};
  const record = {
    messageId,
    channelId,
    surface: surface || prev?.surface || "discord",
    slackTs: slackTs || prev?.slackTs || null,
    contentPreview,
    byEmoji,
    totals,
    reactors: nextReactors,
    reactorCount: Object.keys(nextReactors).length,
    label:
      totals.good > totals.bad ? "good" : totals.bad > totals.good ? "bad" : "neutral",
    firstSeenAt: prev?.firstSeenAt || Date.now(),
    updatedAt: Date.now(),
  };

  const prevKey = JSON.stringify({
    e: prev?.byEmoji || {},
    s: prev?.surface || "",
    r: Object.keys(prev?.reactors || {}).sort(),
  });
  const nextKey = JSON.stringify({
    e: byEmoji,
    s: record.surface,
    r: Object.keys(nextReactors).sort(),
  });
  if (prevKey !== nextKey || !prev) {
    writeJson(messagePath(messageId), record);
    rebuildSummaryFromDisk();
    rebuildGoodExamplesFromDisk();
    rebuildReactorIndexFromDisk();
  }

  return { record, unknowns: unknowns || [] };
}

function goodExamplesPath() {
  return path.join(reactionsDir(), "good-examples.json");
}

/** Top confirmed-good Ava posts — patterns to reinforce in replies. */
function rebuildGoodExamplesFromDisk() {
  const dir = path.join(reactionsDir(), "messages");
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    files = [];
  }
  const rows = [];
  for (const f of files) {
    const rec = readJson(path.join(dir, f), null);
    if (!rec?.totals || (rec.totals.good || 0) < 1) continue;
    if ((rec.totals.bad || 0) > (rec.totals.good || 0)) continue;
    if (!rec.contentPreview || rec.contentPreview.length < 12) continue;
    rows.push({
      messageId: rec.messageId,
      channelId: rec.channelId,
      surface: rec.surface || "discord",
      good: rec.totals.good || 0,
      bad: rec.totals.bad || 0,
      label: rec.label,
      preview: String(rec.contentPreview || "").slice(0, 180),
      updatedAt: rec.updatedAt || 0,
    });
  }
  rows.sort((a, b) => b.good - a.good || b.updatedAt - a.updatedAt);
  const top = rows.slice(0, 40);
  writeJson(goodExamplesPath(), {
    updatedAt: Date.now(),
    count: top.length,
    examples: top,
  });
  return top;
}

export function loadGoodExamples() {
  return readJson(goodExamplesPath(), { examples: [], count: 0, updatedAt: 0 });
}

/** Scan a message batch for Ava posts + reactions. */
export function harvestReactionsFromMessages(
  channelId,
  messages,
  avaBotId,
  { surface = "discord" } = {},
) {
  let touched = 0;
  const unknowns = [];
  const seenKeys = new Set();

  for (const m of messages || []) {
    if (String(m?.author?.id) !== String(avaBotId)) continue;
    const hasRec = Boolean(readJson(messagePath(m.id), null));
    if (!m.reactions?.length && !hasRec) {
      ingestMessageReactions({
        message: { ...m, reactions: m.reactions || [] },
        channelId,
        avaBotId,
        surface,
      });
      touched += 1;
      continue;
    }
    if (m.reactions?.length) {
      const { unknowns: u } = ingestMessageReactions({
        message: m,
        channelId,
        avaBotId,
        surface,
      });
      touched += 1;
      for (const item of u) {
        if (seenKeys.has(item.key)) continue;
        seenKeys.add(item.key);
        unknowns.push(item);
      }
    }
  }
  return { touched, unknowns };
}

/** Scan Slack history / archive rows for Ava posts + reactions. */
export function harvestSlackReactionsFromMessages(
  channelId,
  messages,
  avaBotUserId,
) {
  let touched = 0;
  const unknowns = [];
  const seenKeys = new Set();
  for (const m of messages || []) {
    const fromAva =
      avaBotUserId &&
      (String(m?.user) === String(avaBotUserId) ||
        (!m?.user && m?.bot_id && /—\s*Ava\b/i.test(String(m?.text || ""))));
    if (!fromAva) continue;
    const { unknowns: u } = ingestSlackMessageReactions({
      message: { ...m, __forceAva: true },
      channelId,
      avaBotUserId,
    });
    touched += 1;
    for (const item of u || []) {
      if (seenKeys.has(item.key)) continue;
      seenKeys.add(item.key);
      unknowns.push(item);
    }
  }
  return { touched, unknowns };
}

/** Brief for status / internal packs — never dump counts in Discord. */
export function gatherReactionStatsBrief() {
  const s = loadReactionSummary();
  const learned = loadLearned();
  const learnedN = Object.keys(learned.byKey || {}).length;
  const goods = loadGoodExamples().examples || [];
  if (!s.totalReactions && !s.messagesTracked && !learnedN) {
    return { brief: "### Reaction feedback\n(no reactions logged yet)" };
  }
  const top = Object.entries(s.byEmoji || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([e, n]) => `${e}×${n}`)
    .join(" ");
  const confirmLines = goods
    .slice(0, 6)
    .map(
      (g) =>
        `- [${g.surface || "discord"} · ${g.good}👍] ${String(g.preview || "").replace(/\n/g, " ").slice(0, 140)}`,
    )
    .join("\n");
  return {
    brief: `### Reaction feedback (silent counts — never announce tallies; asking once about unknown emoji meaning is OK)
messages tracked: ${s.messagesTracked} · reactions: ${s.totalReactions} · good ${s.good} / bad ${s.bad} / neutral ${s.neutral}
learned emoji meanings: ${learnedN}
top: ${top || "—"}
### Confirmed-good reply patterns (people reacted positively — prefer this tone/shape)
${confirmLines || "(none yet — keep harvesting Discord + Slack reactions)"}
When writing: lean into confirmed-good patterns (clear, warm, useful, not spammy). Avoid shapes that drew 👎.`,
    summary: s,
    goodExamples: goods,
  };
}

/** Per-reactor vote-factor weights (additive to governance raw_weight). */
export const AVA_REACTION_GOOD_WEIGHT = 0.08;
export const AVA_REACTION_BAD_WEIGHT = -0.2;
export const AVA_REACTION_MAX_BONUS = 3;

function reactorIndexPath() {
  return path.join(reactionsDir(), "reactor-index.json");
}

function emptyReactorBucket(userId, username = null) {
  return {
    userId: String(userId),
    username: username || null,
    emojis: {},
    good: 0,
    bad: 0,
    neutral: 0,
  };
}

/** Live Discord reaction add/remove — stores who reacted. */
export function applyDiscordReactionEvent({
  messageId,
  channelId,
  userId,
  username = null,
  emoji,
  added = true,
  contentPreview = null,
  avaBotId = null,
  messageAuthorId = null,
} = {}) {
  if (!messageId || !userId) return null;
  // Ignore Ava reacting to herself
  if (avaBotId && String(userId) === String(avaBotId)) return null;
  if (avaBotId && messageAuthorId) {
    if (String(messageAuthorId) !== String(avaBotId)) return null;
  } else if (avaBotId) {
    // No author on the gateway event — only update messages we already track as Ava's
    const existing = readJson(messagePath(messageId), null);
    if (!existing) return null;
  }

  const key = emojiStorageKey(emoji);
  const resolved = resolveReaction(emoji);
  const prev = readJson(messagePath(messageId), null) || {
    messageId: String(messageId),
    channelId: channelId || null,
    surface: "discord",
    contentPreview: contentPreview || "",
    byEmoji: {},
    totals: { good: 0, bad: 0, neutral: 0, all: 0 },
    reactors: {},
    firstSeenAt: Date.now(),
  };

  const reactors = { ...(prev.reactors || {}) };
  const byEmoji = { ...(prev.byEmoji || {}) };
  const uid = String(userId);

  if (added) {
    if (!reactors[uid]) reactors[uid] = emptyReactorBucket(uid, username);
    const row = reactors[uid];
    if (username) row.username = username;
    if (!row.emojis[key]) {
      row.emojis[key] = { signal: resolved.signal, count: 0 };
      row[resolved.signal] = (row[resolved.signal] || 0) + 1;
    }
    row.emojis[key].count = (row.emojis[key].count || 0) + 1;
    byEmoji[key] = (byEmoji[key] || 0) + 1;
  } else if (reactors[uid]?.emojis?.[key]) {
    const row = reactors[uid];
    row.emojis[key].count = Math.max(0, (row.emojis[key].count || 1) - 1);
    if (row.emojis[key].count <= 0) {
      const sig = row.emojis[key].signal || resolved.signal;
      row[sig] = Math.max(0, (row[sig] || 1) - 1);
      delete row.emojis[key];
    }
    if (!Object.keys(row.emojis).length) delete reactors[uid];
    byEmoji[key] = Math.max(0, (byEmoji[key] || 1) - 1);
    if (byEmoji[key] <= 0) delete byEmoji[key];
  } else {
    return prev;
  }

  const totals = { good: 0, bad: 0, neutral: 0, all: 0 };
  for (const [ek, count] of Object.entries(byEmoji)) {
    const sig = resolveReaction(ek).signal;
    totals[sig] += count;
    totals.all += count;
  }

  return persistReactionRecord({
    messageId: String(messageId),
    channelId: channelId || prev.channelId || null,
    contentPreview: contentPreview || prev.contentPreview || "",
    byEmoji,
    totals,
    surface: "discord",
    unknowns: [],
    reactors,
  }).record;
}

/**
 * Fetch Discord reactors for each emoji on a message and merge into the store.
 * @param {(path: string, init?: object) => Promise<any>} fetchJson
 */
export async function enrichDiscordMessageReactors(
  fetchJson,
  { channelId, message, avaBotId, sleepMs = 350 } = {},
) {
  if (!fetchJson || !message?.id || !channelId) return null;
  if (String(message.author?.id) !== String(avaBotId)) return null;
  const reactions = Array.isArray(message.reactions) ? message.reactions : [];
  if (!reactions.length) {
    return ingestMessageReactions({
      message,
      channelId,
      avaBotId,
      surface: "discord",
      reactors: {},
    }).record;
  }

  /** @type {Record<string, object>} */
  const reactors = {};
  for (const r of reactions) {
    const emoji = r.emoji || {};
    const key = emojiStorageKey(emoji);
    const param = encodeURIComponent(emojiApiParam(emoji));
    if (!param) continue;
    const resolved = resolveReaction(emoji);
    try {
      let users = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          users = await fetchJson(
            `/channels/${channelId}/messages/${message.id}/reactions/${param}?limit=100`,
          );
          break;
        } catch (err) {
          const msg = String(err?.message || err);
          const retryMatch = msg.match(/retry_after["\s:]+([0-9.]+)/i);
          if (retryMatch && attempt < 3) {
            const waitMs = Math.ceil(Number(retryMatch[1]) * 1000) + 200;
            await new Promise((r) => setTimeout(r, waitMs));
            continue;
          }
          throw err;
        }
      }
      if (!Array.isArray(users)) continue;
      for (const u of users) {
        const id = String(u?.id || "");
        if (!id || id === String(avaBotId)) continue;
        if (!reactors[id]) {
          reactors[id] = emptyReactorBucket(
            id,
            u.global_name || u.username || null,
          );
        }
        const row = reactors[id];
        if (!row.emojis[key]) {
          row.emojis[key] = { signal: resolved.signal, count: 0 };
          row[resolved.signal] = (row[resolved.signal] || 0) + 1;
        }
        row.emojis[key].count = (row.emojis[key].count || 0) + 1;
      }
    } catch (err) {
      console.warn("reaction users fetch:", message.id, key, err.message);
    }
    if (sleepMs > 0) {
      await new Promise((r) => setTimeout(r, sleepMs));
    }
  }

  return ingestMessageReactions({
    message,
    channelId,
    avaBotId,
    surface: "discord",
    reactors,
  }).record;
}

/** Rebuild per-user totals + quality_score from all message reactor maps. */
export function rebuildReactorIndexFromDisk() {
  const dir = path.join(reactionsDir(), "messages");
  /** @type {Record<string, object>} */
  const byUser = {};
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    files = [];
  }
  for (const f of files) {
    const rec = readJson(path.join(dir, f), null);
    if (!rec?.reactors) continue;
    for (const [uid, row] of Object.entries(rec.reactors)) {
      if (!byUser[uid]) {
        byUser[uid] = emptyReactorBucket(uid, row.username || null);
        byUser[uid].messageIds = [];
      }
      const agg = byUser[uid];
      if (row.username) agg.username = row.username;
      agg.good += Number(row.good || 0);
      agg.bad += Number(row.bad || 0);
      agg.neutral += Number(row.neutral || 0);
      if (Array.isArray(agg.messageIds) && agg.messageIds.length < 200) {
        agg.messageIds.push(rec.messageId);
      }
      for (const [ek, meta] of Object.entries(row.emojis || {})) {
        if (!agg.emojis[ek]) {
          agg.emojis[ek] = { signal: meta.signal || "neutral", count: 0 };
        }
        agg.emojis[ek].count += Number(meta.count || 0);
      }
    }
  }

  const factors = [];
  for (const [uid, row] of Object.entries(byUser)) {
    const score = Math.max(
      0,
      Math.min(
        AVA_REACTION_MAX_BONUS,
        Number(
          (
            row.good * AVA_REACTION_GOOD_WEIGHT +
            row.bad * AVA_REACTION_BAD_WEIGHT
          ).toFixed(4),
        ),
      ),
    );
    row.quality_score = score;
    factors.push({
      discord_user_id: uid,
      username: row.username || null,
      good_count: row.good,
      bad_count: row.bad,
      neutral_count: row.neutral,
      quality_score: score,
    });
  }
  factors.sort((a, b) => b.quality_score - a.quality_score || b.good_count - a.good_count);

  const payload = {
    updatedAt: Date.now(),
    userCount: factors.length,
    byUser,
    factors,
  };
  writeJson(reactorIndexPath(), payload);
  return payload;
}

export function loadReactorIndex() {
  return readJson(reactorIndexPath(), {
    updatedAt: 0,
    userCount: 0,
    byUser: {},
    factors: [],
  });
}

/** Discord snowflake IDs only — Slack user ids do not map to governance links. */
export function isDiscordSnowflakeId(id) {
  return /^\d{15,22}$/.test(String(id || "").trim());
}

/** Factors list for API sync / governance (Discord reactors only). */
export function listReactorVoteFactors() {
  const idx = rebuildReactorIndexFromDisk();
  return (idx.factors || []).filter((f) =>
    isDiscordSnowflakeId(f.discord_user_id),
  );
}
