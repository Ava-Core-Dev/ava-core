/**
 * Opportunistic chime-in — keep useful conversation going without requiring @Ava.
 * Alex 2026-08-02: scan everything ~4s; respond when opportunity; chime when useful.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import { AVA_CHANNELS } from "./config.mjs";
import { noUnsolicitedChannelIds } from "./channelPolicy.mjs";
import { isReactOnlyAck, isSoftChat } from "./classify.mjs";
import { shouldAvaEngage } from "./recommend.mjs";
import { discordTrustTier } from "./discordCadence.mjs";

const COOLDOWN_MS = {
  question: 45_000,
  help: 60_000,
  keepAlive: 120_000,
  softInner: 90_000,
  default: 180_000,
};

function statePath() {
  return path.join(storePaths().dir, "chime-in.json");
}

function loadState() {
  try {
    if (!fs.existsSync(statePath())) return { lastByChannel: {} };
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { lastByChannel: {} };
  }
}

function saveState(s) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
}

export function chimeInEnabled() {
  const v = String(process.env.AVA_CHIME_IN || "1").trim();
  return !(v === "0" || /^false$/i.test(v) || /^off$/i.test(v));
}

function isNoChimeChannel(channelId) {
  const id = String(channelId || "");
  if (noUnsolicitedChannelIds().has(id)) return true;
  // Alex: unsolicited one-liners off in #random-facts — only reply when addressed
  if (id === AVA_CHANNELS.randomFacts || id === "1531432703675596942") return true;
  return false;
}

function looksLikeHelpOrQuestion(text = "") {
  const t = String(text || "");
  if (/\?/.test(t)) return true;
  return /\b(how\s+(do|can|to)|anyone\s+know|help\s+me|stuck|where\s+(is|do)|what\s+(is|are)|can\s+someone|does\s+anyone)\b/i.test(
    t,
  );
}

function looksLikeRootMcTopic(text = "") {
  return /\b(rootmc|gold\b|\/bal|\/link|\/vote|\/proposal|\/ava|towny|claims|wiki|map\.rootmc|play\.rootmc|pro\b|vote\s*shards?|shockbyte|spawn|rtp|keepinv)\b/i.test(
    String(text || ""),
  );
}

function avaSpokeRecently(messages = [], botAppId, withinMs = 15 * 60_000) {
  const now = Date.now();
  for (const m of messages || []) {
    if (!m?.id || String(m.author?.id) !== String(botAppId)) continue;
    const ts = Number((BigInt(m.id) >> 22n) + 1420070400000n);
    if (now - ts <= withinMs) return true;
  }
  return false;
}

function cooldownOk(channelId, kind) {
  const state = loadState();
  state.lastByChannel = state.lastByChannel || {};
  const last = Number(state.lastByChannel[channelId] || 0);
  const need = COOLDOWN_MS[kind] || COOLDOWN_MS.default;
  if (Date.now() - last < need) return false;
  state.lastByChannel[channelId] = Date.now();
  // prune
  for (const [k, at] of Object.entries(state.lastByChannel)) {
    if (Date.now() - at > 6 * 60 * 60 * 1000) delete state.lastByChannel[k];
  }
  saveState(state);
  return true;
}

/**
 * @returns {{ chime: boolean, kind?: string, reason?: string }}
 */
export function shouldAvaChimeIn({
  msg,
  channelId,
  messages = [],
  botAppId = "",
} = {}) {
  if (!chimeInEnabled()) return { chime: false, reason: "disabled" };
  if (!msg || msg.author?.bot) return { chime: false, reason: "bot" };
  if (String(msg.author?.id) === String(botAppId)) {
    return { chime: false, reason: "self" };
  }
  // Already a hard engage — caller shouldn't need this
  if (shouldAvaEngage(msg, botAppId)) {
    return { chime: false, reason: "already_addressed" };
  }

  const ch = String(channelId || msg.channel_id || "");
  if (isNoChimeChannel(ch)) {
    return { chime: false, reason: "no_unsolicited_channel" };
  }

  const text = String(msg.content || "").trim();
  if (!text || text.length < 8) return { chime: false, reason: "too_short" };
  if (isReactOnlyAck(text, text)) return { chime: false, reason: "react_only" };

  const tier = discordTrustTier(msg.author?.id);
  const helpQ = looksLikeHelpOrQuestion(text);
  const rootmc = looksLikeRootMcTopic(text);
  const soft = isSoftChat(text, text);
  const keep =
    avaSpokeRecently(messages, botAppId) &&
    (helpQ || rootmc || (tier === "inner" && !soft));

  let kind = null;
  if (helpQ && (rootmc || tier === "inner" || tier === "trusted" || tier === "familiar")) {
    kind = "question";
  } else if (helpQ && rootmc) {
    kind = "help";
  } else if (keep) {
    kind = "keepAlive";
  } else if (tier === "inner" && (rootmc || helpQ)) {
    kind = "softInner";
  } else if (rootmc && helpQ) {
    kind = "help";
  }

  if (!kind) return { chime: false, reason: "no_opportunity" };
  if (!cooldownOk(ch, kind)) return { chime: false, reason: "cooldown" };

  return { chime: true, kind, reason: kind };
}

/** Prompt cue when chiming unprompted. */
export function chimeInBrief(kind = "default") {
  return `### Chime-in mode (${kind})
You were NOT @mentioned — you're chiming in because it's useful.
Keep it short (1-4 lines). Lead-dev helpful. Don't hijack. Don't dig Slack work here.
If unsure, ask one clarifying question. Sign - Ava.`;
}
