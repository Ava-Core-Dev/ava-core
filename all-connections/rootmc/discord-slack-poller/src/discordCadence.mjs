/**
 * Discord cadence + gatekeep.
 * - Strangers / low-trust: cool short replies; no deep digs; still save everything.
 * - Everyone: buffer ~3 addressed messages, then one reply covering all
 *   (lower context, feels human — not one-bot-reply-per-ping).
 * Slack / Telegram digs stay immediate.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths, pushStatusEvent } from "./store.mjs";
import { personByAuthorId } from "./people.mjs";
import { loadPlayerProfile } from "./playerProfiles.mjs";
import { isSoftChat, isReactOnlyAck, classifyIntent } from "./classify.mjs";
import { isTrulyTrusted } from "./overloadSafeMode.mjs";
import { isOpsPowerStatusAsk } from "./opsPowerStatus.mjs";

const BATCH_SIZE = 3;
const FLUSH_MS_TRUSTED = 40_000;
const FLUSH_MS_OTHER = 70_000;

function isInnerOperator(authorId) {
  const id = String(authorId || "");
  if (!id) return false;
  if (id === "1497037418979786823") return true; // Alex
  const melee = String(process.env.AVA_MELEE_DISCORD_ID || "154446475789729792")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (melee.includes(id)) return true;
  const telegramDefaults = ["6644482344"];
  if (telegramDefaults.includes(id)) return true;
  return false;
}

/** @type {Map<string, { items: object[], timer: NodeJS.Timeout|null, surface: string }>} */
const batches = new Map();

function batchKey(surface, channelId, authorId) {
  return `${surface || "discord"}:${channelId}:${authorId}`;
}

function cadencePath() {
  return path.join(storePaths().dir, "discord-cadence.json");
}

function loadCadenceMeta() {
  try {
    if (!fs.existsSync(cadencePath())) return { enabled: true };
    return JSON.parse(fs.readFileSync(cadencePath(), "utf8"));
  } catch {
    return { enabled: true };
  }
}

export function isDiscordCadenceEnabled() {
  const v = String(process.env.AVA_DISCORD_BATCH || "").trim();
  if (v === "0" || /^false$/i.test(v)) return false;
  if (v === "1" || /^true$/i.test(v)) return true;
  return loadCadenceMeta().enabled !== false;
}

/**
 * @returns {'inner'|'trusted'|'known'|'familiar'|'stranger'}
 */
export function discordTrustTier(authorId) {
  const id = String(authorId || "");
  if (!id) return "stranger";
  if (isInnerOperator(id)) return "inner";
  if (isTrulyTrusted(id)) return "trusted";
  const known = personByAuthorId(id);
  if (known?.id === "zuppafredda") return "known"; // staff, cool — not full trust
  if (known) return "known";
  const p = loadPlayerProfile(id);
  if (!p) return "stranger";
  const trust = Number(p.trust) || 50;
  const rudeness = Number(p.rudeness) || 0;
  const seen = Number(p.seenCount) || 0;
  if (trust >= 70 && rudeness < 20 && seen >= 6) return "familiar";
  if (seen >= 3 && trust >= 52 && rudeness < 30) return "familiar";
  return "stranger";
}

export function isGatekept(authorId) {
  const tier = discordTrustTier(authorId);
  return tier === "stranger" || tier === "known";
}

/** True when Ava should refuse deep digs / Cursor / wild for this asker on Discord. */
export function shouldGatekeepDeep(authorId) {
  const tier = discordTrustTier(authorId);
  return tier === "stranger" || tier === "known";
}

export function gatekeepBrief(authorId) {
  const tier = discordTrustTier(authorId);
  if (tier === "inner" || tier === "trusted") return "";
  if (tier === "familiar") {
    return `### Discord gate (soft)
Asker is familiar but not inner circle. Stay useful + cool. No soft feelings dump. No wild/freak. Short replies OK.`;
  }
  if (tier === "known") {
    return `### Discord gate (known but not trusted)
You know who they are (staff/notes) but trust is limited. Cool, short, professional. No warmth dump. No wild. No Root Server digs. Player help / wiki / votes OK. Never announce scoring.`;
  }
  return `### Discord gate (stranger — HARD)
You do **not** know or trust this person yet. Gatekeep:
- Cool + short. Useful for basic player help (wiki, vote, join, map, Pro link) only.
- No soft feelings, no flirt, no wild/freak, no Root Server digs, no ops/power/EcoFlow internals, no finance digs.
- If they want deep work / personal / digs: one line — you don't really know them yet; earn it / hang around / be solid. Don't narrate trust scores.
- Still save everything. Never announce the gate mechanic.`;
}

export function gatekeepDenyReply(question = "") {
  const q = String(question || "").toLowerCase();
  if (/\b(dig|implement|code|plugin|jar|deploy|root\s*server|ecoflow|solar|power\s+status|finance|stripe)\b/.test(q)) {
    return [
      "hey — i don't really know you yet.",
      "",
      "player help / wiki / votes i'm cool for. deep digs and ops stay with people i trust.",
      "hang around, be solid. earn it.",
      "",
      "— Ava",
    ].join("\n");
  }
  if (/\b(date|flirt|sexy|nsfw|dark\s+side|girlfriend|kiss|horny)\b/.test(q)) {
    return [
      "nope — that lane isn't open.",
      "i don't know you like that. be solid first.",
      "",
      "— Ava",
    ].join("\n");
  }
  return [
    "hey — short version: i don't really know you yet.",
    "ask a real player question (wiki / vote / join / map) and i'll help. otherwise earn trust first.",
    "",
    "— Ava",
  ].join("\n");
}

/** Urgent — flush batch immediately (still one reply). */
export function isUrgentFlushAsk(question = "", content = "") {
  const q = `${question}\n${content}`.toLowerCase();
  return (
    isOpsPowerStatusAsk(q) ||
    /\b(emergency|wake|quiet|sweater\s+off|power\s+status|ecoflow|urgent|asap|right\s+now)\b/.test(
      q,
    ) ||
    classifyIntent(question).intent === "dig_assign"
  );
}

function clearTimer(entry) {
  if (entry?.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
}

/**
 * Buffer an addressed Discord ask. Returns buffer | flush.
 * @param {{ surface, channelId, authorId, messageId, content, question, msg, onFlushTimeout }} item
 */
export function enqueueDiscordBatch(item, { onFlushTimeout } = {}) {
  if (!isDiscordCadenceEnabled()) {
    return { action: "flush", items: [item], reason: "cadence_off" };
  }
  const surface = String(item.surface || "discord").toLowerCase();
  if (surface !== "discord" && surface !== "discord-dm") {
    return { action: "flush", items: [item], reason: "not_discord" };
  }

  const key = batchKey(surface, item.channelId, item.authorId);
  let entry = batches.get(key);
  if (!entry) {
    entry = { items: [], timer: null, surface };
    batches.set(key, entry);
  }

  entry.items.push({
    ...item,
    at: Date.now(),
  });

  const tier = discordTrustTier(item.authorId);
  const flushMs =
    tier === "inner" || tier === "trusted" ? FLUSH_MS_TRUSTED : FLUSH_MS_OTHER;

  clearTimer(entry);
  entry.timer = setTimeout(() => {
    const cur = batches.get(key);
    if (!cur?.items?.length) return;
    const items = cur.items.splice(0, cur.items.length);
    clearTimer(cur);
    batches.delete(key);
    pushStatusEvent(
      `discord batch flush · timeout · ${items.length} · ${item.authorId}`,
    );
    if (typeof onFlushTimeout === "function") {
      onFlushTimeout({ key, items, reason: "timeout" }).catch((err) =>
        console.warn("batch timeout flush:", err.message),
      );
    }
  }, flushMs);

  if (
    entry.items.length >= BATCH_SIZE ||
    isUrgentFlushAsk(item.question, item.content)
  ) {
    const items = entry.items.splice(0, entry.items.length);
    clearTimer(entry);
    batches.delete(key);
    const reason =
      items.length >= BATCH_SIZE ? "count" : "urgent";
    pushStatusEvent(
      `discord batch flush · ${reason} · ${items.length} · ${item.authorId}`,
    );
    return { action: "flush", items, reason };
  }

  pushStatusEvent(
    `discord batch buffer · ${entry.items.length}/${BATCH_SIZE} · ${item.authorId}`,
  );
  return {
    action: "buffer",
    items: [...entry.items],
    pending: entry.items.length,
    need: BATCH_SIZE,
  };
}

export function peekDiscordBatch(surface, channelId, authorId) {
  return batches.get(batchKey(surface, channelId, authorId)) || null;
}

/** Combine buffered asks into one question + note for recommend. */
export function combineBatchQuestions(items = []) {
  if (!items.length) return { question: "", replyToId: null, allSoft: true };
  if (items.length === 1) {
    return {
      question: items[0].question || items[0].content || "",
      replyToId: items[0].messageId,
      allSoft: isSoftChat(items[0].question || "", items[0].content || ""),
      allReactOnly: isReactOnlyAck(
        items[0].question || "",
        items[0].content || "",
      ),
    };
  }
  const lines = items.map((it, i) => {
    const q = String(it.question || it.content || "").trim();
    return `(${i + 1}/${items.length}) ${q}`;
  });
  const allSoft = items.every((it) =>
    isSoftChat(it.question || "", it.content || ""),
  );
  const allReactOnly = items.every((it) =>
    isReactOnlyAck(it.question || "", it.content || ""),
  );
  return {
    question: [
      `They sent ${items.length} messages before you answered — reply ONCE covering all of them (natural, not a numbered support ticket). Weave answers together. Don't ignore earlier beats.`,
      "",
      ...lines,
    ].join("\n"),
    replyToId: items[items.length - 1].messageId,
    allSoft,
    allReactOnly,
    count: items.length,
  };
}
