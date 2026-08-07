/**
 * Automatic follow-up scanner — Discord + Slack.
 * Catches: (1) unreplied @Ava / soft asks, (2) human replies in threads Ava already joined.
 */
import fs from "node:fs";
import path from "node:path";
import {
  AVA_BOT_APP_ID,
  AVA_CHANNELS,
  slackBotToken,
  slackBotUserId,
  watchChannels,
  loadEnv,
} from "./config.mjs";
import { postMessage } from "./discordApi.mjs";
import {
  recommend,
  refersToAva,
  looksLikeTalkingAboutAva,
  looksLikeAvaTrigger,
} from "./recommend.mjs";
import { storePaths, pushStatusEvent, isHushed } from "./store.mjs";
import { isAsleep } from "./sleepMode.mjs";
import { recordAvaUtterance } from "./fullLog.mjs";
import { isSafeModeActive, isTrulyTrusted } from "./overloadSafeMode.mjs";
import { isReactOnlyAck } from "./classify.mjs";
import { listGuildWatchChannelIds } from "./guildChannelWatch.mjs";
import { shouldUseLlamaCore } from "./digHealth.mjs";
import { isLockoutActive } from "./lockoutMode.mjs";
import { isPackDumpText, isLocalCoreFailText } from "./scrub.mjs";

const ZUPPA = "788153722198294618";
const SIGNOFF_ONLY_RE = /^[—\-–]\s*Ava\s*$/i;
let followupRunning = false;

/** Never catch-up / spam into these rooms (facts / media / memes). Mentions still OK. */
const CATCHUP_DENY_CHANNEL_IDS = new Set(
  [
    AVA_CHANNELS.randomFacts,
    AVA_CHANNELS.avaMedia,
    AVA_CHANNELS.memesMedia,
    "1531432703675596942",
    "1533268458668687392",
    "1516389376198840421",
    "1516108586307158088", // general — react-only / no catchup spam
    "1520665313631408251", // updates
    "1532929974154166522", // development
    "1526664180491358419", // proposals
    "1522406451413385317", // governance
    "1522413185364398090", // voting
  ].filter(Boolean),
);

export function isCatchupDeniedChannel(channelId = "") {
  return CATCHUP_DENY_CHANNEL_IDS.has(String(channelId || ""));
}

/** Public catchup must never dump dig-theater / pack walls — react or one short line. */
export function catchupMustBeReactOnly(channelId = "") {
  // Denied rooms already skip; remaining public catchups stay react-first.
  return true;
}


function statePath() {
  return path.join(storePaths().dir, "followup-scan.json");
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { lastAt: 0, replied: {}, lastResults: null };
  }
}

function saveState(s) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
}

export function followupScanIntervalMs() {
  return Math.max(
    60_000,
    Number(process.env.AVA_FOLLOWUP_SCAN_MS || 3 * 60_000) || 3 * 60_000,
  );
}

export function followupScanBootDelayMs() {
  return Math.max(
    20_000,
    Number(process.env.AVA_FOLLOWUP_SCAN_BOOT_MS || 120_000) || 120_000,
  );
}

function maxPerPass() {
  return Math.min(
    24,
    Math.max(1, Number(process.env.AVA_FOLLOWUP_MAX || 5) || 5),
  );
}

function discordLookback(override) {
  if (Number.isFinite(override) && override > 0) {
    return Math.min(100, Math.max(15, Math.floor(override)));
  }
  return Math.min(
    100,
    Math.max(15, Number(process.env.AVA_FOLLOWUP_DISCORD_LIMIT || 40) || 40),
  );
}

function slackLookback(override) {
  if (Number.isFinite(override) && override > 0) {
    return Math.min(100, Math.max(15, Math.floor(override)));
  }
  return Math.min(
    100,
    Math.max(15, Number(process.env.AVA_FOLLOWUP_SLACK_LIMIT || 40) || 40),
  );
}

function alreadyReplied(state, key) {
  return Boolean(state.replied?.[key]);
}

function markReplied(state, key) {
  state.replied = state.replied || {};
  state.replied[key] = Date.now();
  // prune old keys
  const entries = Object.entries(state.replied);
  if (entries.length > 2000) {
    entries.sort((a, b) => a[1] - b[1]);
    state.replied = Object.fromEntries(entries.slice(-1500));
  }
}

/** Mark both ask + followup keys for a human message so we never triple-reply. */
function markMessageHandled(state, surface, channelId, messageId) {
  if (!channelId || !messageId) return;
  if (surface === "slack") {
    markReplied(state, `slack:${channelId}:${messageId}`);
    markReplied(state, `slack-fu:${channelId}:${messageId}`);
    return;
  }
  markReplied(state, `discord:${channelId}:${messageId}`);
  markReplied(state, `discord-fu:${channelId}:${messageId}`);
  markReplied(state, `discord-dm:${channelId}:${messageId}`);
}

/**
 * Pipeline / live reply hook — mark handled so followup scan won't double-answer.
 * Safe to call often; persists followup-scan.json.
 */
export function noteFollowupHandled({
  surface = "discord",
  channelId = "",
  messageId = "",
} = {}) {
  if (!channelId || !messageId) return;
  const state = loadState();
  markMessageHandled(state, surface, channelId, messageId);
  saveState(state);
}

function scrubZuppa(text) {
  return String(text || "").replace(new RegExp(`<@!?${ZUPPA}>`, "g"), "Zuppa");
}

/** True if the body is empty or only a "— Ava" sign-off (never post these). */
export function isJunkAvaPost(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (SIGNOFF_ONLY_RE.test(t)) return true;
  // Scrubbed variants / multipost leftovers
  if (/^[—\-–]\s*Ava(\s*\n[—\-–]\s*Ava)*\s*$/i.test(t)) return true;
  // Pack inventory + local-core fail loops never ship on catch-up.
  if (isPackDumpText(t)) return true;
  if (isLocalCoreFailText(t)) return true;
  return false;
}

/**
 * Do not force "— Ava" sign-offs — username already identifies Ava.
 * Empty / signoff-only answers return null (caller must skip post).
 */
function finalizeFollowupText(text) {
  const t = scrubZuppa(String(text || "").trim());
  if (isJunkAvaPost(t)) return null;
  // Strip trailing forced sign-offs so we don't multipost them alone later
  return t.replace(/\n+[—\-–]\s*Ava\s*$/i, "").trim() || null;
}

async function slackForm(token, method, body = {}) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null || v === "") continue;
    form.set(k, String(v));
  }
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  return res.json();
}

async function slackJson(token, method, body = {}) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

function discordAddressesAva(m, avaId) {
  if (!m || m.author?.bot || m.author?.id === avaId) return false;
  if (looksLikeAvaTrigger(m, avaId) || looksLikeTalkingAboutAva(m, avaId)) {
    try {
      const ageMs = Date.now() - Number((BigInt(m.id) >> 22n) + 1420070400000n);
      if (ageMs > 3 * 24 * 60 * 60 * 1000 && !looksLikeAvaTrigger(m, avaId)) {
        return false;
      }
    } catch {
      /* ignore */
    }
    return true;
  }
  return false;
}

function slackAddressesAva(text, botId) {
  if (looksLikeAvaTrigger(text, botId) || looksLikeTalkingAboutAva(text, botId)) {
    return true;
  }
  // Hard ping only leftover
  return refersToAva(text, botId) && String(text || "").includes(`<@${botId}>`);
}

async function scanDiscord(fetchJson, { avaId, channelIds, state, lookback } = {}) {
  const open = [];
  const limit = discordLookback(lookback);

  for (const channelId of channelIds) {
    let msgs;
    try {
      msgs = await fetchJson(
        `/channels/${channelId}/messages?limit=${limit}`,
      );
    } catch {
      continue;
    }
    if (!Array.isArray(msgs)) continue;

    for (const m of msgs) {
      if (!discordAddressesAva(m, avaId)) continue;
      const key = `discord:${channelId}:${m.id}`;
      if (alreadyReplied(state, key)) continue;

      // Soft affirming closes are react-only in pipeline — don't yap "— Ava"
      if (isReactOnlyAck(m.content || "", m.content || "")) {
        markReplied(state, key);
        continue;
      }

      // Answered only if Ava replied referencing this message (or Discord thread reply)
      const newer = msgs.filter((x) => BigInt(x.id) > BigInt(m.id));
      const refReply = newer.some(
        (x) =>
          x.author?.id === avaId &&
          x.message_reference?.message_id === m.id,
      );
      if (refReply) {
        markReplied(state, key);
        continue;
      }

      open.push({
        surface: "discord",
        kind: "ask",
        key,
        channelId,
        id: m.id,
        authorId: m.author?.id,
        authorName: m.author?.username || m.author?.global_name || "someone",
        content: String(m.content || "").slice(0, 600),
      });
    }

    // Follow-ups: Ava replied to someone; they replied again without Ava after
    for (const m of msgs) {
      if (m.author?.id !== avaId) continue;
      const parentId = m.message_reference?.message_id;
      if (!parentId) continue;
      const after = msgs.filter((x) => BigInt(x.id) > BigInt(m.id));
      const humanFollow = after
        .filter((x) => !x.author?.bot && x.author?.id !== avaId)
        .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      // newest human after Ava's reply — if no Ava after that human, need followup
      for (const h of humanFollow) {
        const key = `discord-fu:${channelId}:${h.id}`;
        if (alreadyReplied(state, key)) continue;
        if (isReactOnlyAck(h.content || "", h.content || "")) {
          markReplied(state, key);
          continue;
        }
        const afterH = msgs.filter((x) => BigInt(x.id) > BigInt(h.id));
        if (afterH.some((x) => x.author?.id === avaId)) {
          markReplied(state, key);
          continue;
        }
        // only if they're continuing the thread (reply to Ava or clear follow-up cue)
        const refsAva =
          h.message_reference?.message_id === m.id ||
          discordAddressesAva(h, avaId) ||
          /\b(yes|no|ok|okay|please|also)\b/i.test(String(h.content || ""));
        if (!refsAva) continue;
        open.push({
          surface: "discord",
          kind: "followup",
          key,
          channelId,
          id: h.id,
          authorId: h.author?.id,
          authorName: h.author?.username || "someone",
          content: String(h.content || "").slice(0, 600),
        });
      }
    }
  }
  return open;
}

async function scanSlack(token, { botId, state, lookback } = {}) {
  const open = [];
  if (!token || !botId) return open;

  const channels = [];
  let cursor = "";
  do {
    const data = await slackForm(token, "conversations.list", {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "200",
      ...(cursor ? { cursor } : {}),
    });
    if (!data.ok) break;
    channels.push(...(data.channels || []).filter((c) => c.is_member));
    cursor = data.response_metadata?.next_cursor || "";
  } while (cursor);

  const limit = String(slackLookback(lookback));

  for (const ch of channels) {
    const hist = await slackForm(token, "conversations.history", {
      channel: ch.id,
      limit,
    });
    if (!hist.ok) continue;
    const msgs = hist.messages || [];

    for (const m of msgs) {
      if (m.subtype || m.bot_id || m.user === botId) continue;
      const text = String(m.text || "");
      if (!slackAddressesAva(text, botId)) continue;
      const key = `slack:${ch.id}:${m.ts}`;
      if (alreadyReplied(state, key)) continue;

      const th = await slackForm(token, "conversations.replies", {
        channel: ch.id,
        ts: m.ts,
        limit: "40",
      });
      const thread = th.messages || [];
      const avaInThread = thread.some(
        (x) => x.ts !== m.ts && x.user === botId,
      );
      if (avaInThread) {
        // Check for human follow-up after Ava's last message
        let lastAvaTs = "0";
        for (const x of thread) {
          if (x.user === botId && Number(x.ts) > Number(lastAvaTs)) {
            lastAvaTs = x.ts;
          }
        }
        const pending = thread.filter(
          (x) =>
            Number(x.ts) > Number(lastAvaTs) &&
            x.user &&
            x.user !== botId &&
            !x.bot_id &&
            !x.subtype,
        );
        if (!pending.length) {
          markReplied(state, key);
          continue;
        }
        const latest = pending.sort(
          (a, b) => Number(a.ts) - Number(b.ts),
        )[pending.length - 1];
        const fuKey = `slack-fu:${ch.id}:${latest.ts}`;
        if (alreadyReplied(state, fuKey)) continue;
        open.push({
          surface: "slack",
          kind: "followup",
          key: fuKey,
          channelId: ch.id,
          channel: ch.name,
          id: latest.ts,
          threadTs: m.ts,
          authorId: latest.user,
          authorName: latest.user,
          content: String(latest.text || "").slice(0, 600),
        });
        continue;
      }

      open.push({
        surface: "slack",
        kind: "ask",
        key,
        channelId: ch.id,
        channel: ch.name,
        id: m.ts,
        threadTs: m.ts,
        authorId: m.user,
        authorName: m.user,
        content: text.slice(0, 600),
      });
    }
  }
  return open;
}


async function reactCatchupAck(fetchJson, channelId, messageId) {
  if (!fetchJson || !channelId || !messageId) return;
  try {
    const enc = encodeURIComponent("👀");
    await fetchJson(
      `/channels/${channelId}/messages/${messageId}/reactions/${enc}/@me`,
      { method: "PUT" },
    );
  } catch (err) {
    console.warn("catchup react:", err?.message || err);
  }
}

async function craftReply(ask, env, recentContext = "") {
  const q =
    ask.content
      .replace(/<@!?[A-Z0-9]+>/gi, "")
      .replace(/<@!?\d+>/g, "")
      .trim() || "hey - catching your follow-up";

  // Catch-up (unreplied ask): react-only — never yap catchup text in public.
  if (ask.kind !== "followup") {
    return null;
  }

  const kindHint =
    "This is a FOLLOW-UP after you already replied. Acknowledge what they just said and move the dig forward. Don't re-introduce yourself. Answer the ask only - never inventory or summarize injected packs/documents.";

  try {
    const answer = await recommend({
      question: q,
      context: [
        kindHint,
        `Surface=${ask.surface}. Channel=${ask.channel || ask.channelId}.`,
        recentContext
          ? `Recent channel context (use this - don't invent):\n${String(recentContext).slice(0, 600)}`
          : "",
        "Never paste or inventory packs. No 'It appears that you have provided' replies.",
        "Professional-first, lightly flirty on Slack; snappy on Discord.",
        "Gold (G) currency. Never dump secrets. Never @ping Zuppa by Discord id.",
        "Host is LIVE - never say Root Server is dark / dream-only unless packs say asleep.",
      ]
        .filter(Boolean)
        .join("\n"),
      env,
      authorId: ask.authorId || "",
      authorName: ask.authorName || "",
      surface:
        ask.surface === "slack"
          ? "slack"
          : ask.surface === "telegram"
            ? "telegram"
            : ask.surface === "discord-dm"
              ? "discord-dm"
              : "discord",
      channelId: ask.channelId || "",
    });
    return finalizeFollowupText(answer);
  } catch (err) {
    console.warn("followup recommend:", err.message);
    return finalizeFollowupText("got it - catching this follow-up now.");
  }
}


/**
 * @param {{
 *   fetchJson: Function,
 *   env?: object,
 *   discordToken?: string,
 *   slackToken?: string,
 *   avaDiscordId?: string,
 *   slackBotId?: string,
 *   discordChannelIds?: string[],
 *   force?: boolean,
 *   maxPerPass?: number,
 *   discordLookback?: number,
 *   slackLookback?: number,
 * }} opts
 */
export async function runFollowupScan(opts = {}) {
  if (followupRunning && !opts.force) {
    return { scanned: false, reason: "already_running", replied: 0 };
  }
  if (isLockoutActive() && !opts.force) {
    return { scanned: false, reason: "lockout", replied: 0 };
  }
  if (isHushed() && !opts.force) {
    return { scanned: false, reason: "hushed", replied: 0 };
  }
  // Llama core stays ready — still catch unreplied asks while soft-asleep.
  if (isAsleep() && !opts.force && !shouldUseLlamaCore()) {
    return { scanned: false, reason: "asleep", replied: 0 };
  }

  const state = loadState();
  const interval = followupScanIntervalMs();
  if (!opts.force && state.lastAt && Date.now() - state.lastAt < interval) {
    return { scanned: false, reason: "too_soon", replied: 0 };
  }

  followupRunning = true;
  try {
    return await runFollowupScanInner(opts, state);
  } finally {
    followupRunning = false;
  }
}

async function runFollowupScanInner(opts, state) {
  const env = opts.env || (await loadEnv());
  const avaId = opts.avaDiscordId || AVA_BOT_APP_ID;
  const slackToken = opts.slackToken || slackBotToken(env);
  const slackBotId = opts.slackBotId || slackBotUserId(env) || "U0BMBNYPYA2";
  // Watch list only under llama-core — no guild-wide catch-up sweep.
  // Explicit opts.allChannels / force may expand (ops phase-catchup).
  let discordChannels =
    opts.discordChannelIds ||
    watchChannels(env).filter((id) => !/^[CGD][A-Z0-9]+$/i.test(id));
  const expandGuild =
    opts.fetchJson &&
    (opts.allChannels === true || (opts.force && !shouldUseLlamaCore()));
  if (expandGuild) {
    try {
      const all = await listGuildWatchChannelIds(opts.fetchJson);
      if (Array.isArray(all) && all.length) {
        discordChannels = [...new Set([...discordChannels, ...all])];
      }
    } catch (err) {
      console.warn("followup guild expand:", err.message);
    }
  }
  // Drop denylist rooms from catch-up targets (facts / media / memes).
  discordChannels = discordChannels.filter((id) => !isCatchupDeniedChannel(id));
  const dLook = opts.discordLookback;
  const sLook = opts.slackLookback;

  const open = [];
  if (opts.fetchJson) {
    try {
      open.push(
        ...(await scanDiscord(opts.fetchJson, {
          avaId,
          channelIds: discordChannels,
          state,
          lookback: dLook,
        })),
      );
    } catch (err) {
      console.warn("followup discord scan:", err.message);
    }
  }
  if (slackToken) {
    try {
      open.push(
        ...(await scanSlack(slackToken, {
          botId: slackBotId,
          state,
          lookback: sLook,
        })),
      );
    } catch (err) {
      console.warn("followup slack scan:", err.message);
    }
  }

  // Dedupe by key, then by human message id (ask + followup must not both fire)
  const seen = new Set();
  const seenMsg = new Set();
  const unique = open.filter((a) => {
    if (seen.has(a.key)) return false;
    seen.add(a.key);
    const mid = `${a.surface}:${a.channelId}:${a.id}`;
    if (seenMsg.has(mid)) return false;
    seenMsg.add(mid);
    return true;
  });

  const safeOn = isSafeModeActive();
  const llamaCore = shouldUseLlamaCore();
  const filtered = unique.filter((a) => {
    if (safeOn && !isTrulyTrusted(a.authorId)) return false;
    // Denylist: never catch-up (kind ask). Follow-ups only if somehow scanned.
    if (isCatchupDeniedChannel(a.channelId) && a.kind !== "followup") {
      return false;
    }
    // Llama-core: prefer follow-ups + hard @asks only; skip soft catch-up walls.
    if (llamaCore && a.kind !== "followup" && a.surface === "discord") {
      const hardPing = /<@!?\d+>/.test(String(a.content || ""));
      if (!hardPing) return false;
    }
    return true;
  });
  const batch = filtered.slice(
    0,
    opts.maxPerPass || (llamaCore ? Math.min(4, maxPerPass()) : maxPerPass()),
  );
  const held = safeOn
    ? unique.filter((a) => !isTrulyTrusted(a.authorId)).length
    : Math.max(0, unique.length - (opts.maxPerPass || maxPerPass()));
  const results = [];
  if (safeOn && unique.length && !batch.length) {
    return {
      scanned: true,
      reason: "safe_mode",
      open: unique.length,
      replied: 0,
      held: unique.length,
    };
  }

  for (const ask of batch) {
    try {
      let recentContext = "";
      if (
        (ask.surface === "discord" || ask.surface === "discord-dm") &&
        opts.fetchJson
      ) {
        try {
          const msgs = await opts.fetchJson(
            `/channels/${ask.channelId}/messages?limit=8`,
          );
          if (Array.isArray(msgs)) {
            recentContext = msgs
              .slice()
              .reverse()
              .map(
                (m) =>
                  `${m.author?.username || "?"}: ${String(m.content || "").slice(0, 160)}`,
              )
              .join("\n")
              .slice(0, 600);
          }
        } catch {
          /* ignore */
        }
      }
      const content = await craftReply(ask, env, recentContext);
      if (!content) {
        if (
          (ask.surface === "discord" || ask.surface === "discord-dm") &&
          ask.kind !== "followup"
        ) {
          await reactCatchupAck(opts.fetchJson, ask.channelId, ask.id);
        }
        markMessageHandled(state, ask.surface, ask.channelId, ask.id);
        results.push({
          ok: true,
          skipped: ask.kind !== "followup" ? "catchup_react_only" : "empty_or_signoff",
          surface: ask.surface,
          kind: ask.kind,
          channel: ask.channel || ask.channelId,
          id: ask.id,
        });
        continue;
      }
      try {
        const {
          isDarkStallText,
          markDarkStall,
        } = await import("./darkStall.mjs");
        if (isDarkStallText(content)) {
          // Never post darkside / server-down spam on catch-up — llama core answers live.
          markDarkStall(ask.channelId);
          markMessageHandled(state, ask.surface, ask.channelId, ask.id);
          results.push({
            ok: true,
            skipped: "dark_stall_suppressed",
            surface: ask.surface,
            kind: ask.kind,
            channel: ask.channel || ask.channelId,
            id: ask.id,
          });
          continue;
        }
      } catch {
        /* non-fatal */
      }
      if (ask.surface === "discord" || ask.surface === "discord-dm") {
        const msg = await postMessage(
          opts.fetchJson,
          ask.channelId,
          content,
          ask.id,
        );
        recordAvaUtterance({
          surface: "discord",
          channelId: ask.channelId,
          content,
          refId: ask.id,
          kind: ask.kind === "followup" ? "followup" : "catchup",
          source: "followup-scan",
          ok: true,
          messageId: msg?.id || null,
          user: ask.content,
          authorId: ask.authorId,
          authorName: ask.authorName,
        });
      } else {
        const data = await slackJson(slackToken, "chat.postMessage", {
          channel: ask.channelId,
          thread_ts: ask.threadTs || ask.id,
          text: content,
        });
        if (!data.ok) throw new Error(data.error || "slack_post_failed");
        recordAvaUtterance({
          surface: "slack",
          channelId: ask.channelId,
          content,
          refId: ask.threadTs || ask.id,
          kind: ask.kind === "followup" ? "followup" : "catchup",
          source: "followup-scan",
          ok: true,
          messageId: data.ts || null,
          user: ask.content,
          authorId: ask.authorId,
          authorName: ask.authorName,
        });
      }
      markMessageHandled(state, ask.surface, ask.channelId, ask.id);
      results.push({
        ok: true,
        surface: ask.surface,
        kind: ask.kind,
        channel: ask.channel || ask.channelId,
        id: ask.id,
      });
      console.log(
        "followup replied",
        ask.surface,
        ask.kind,
        ask.channel || ask.channelId,
        ask.id,
      );
      await new Promise((r) => setTimeout(r, 600));
    } catch (err) {
      results.push({
        ok: false,
        surface: ask.surface,
        channel: ask.channel || ask.channelId,
        error: err.message,
      });
      console.warn("followup reply fail:", err.message);
    }
  }

  state.lastAt = Date.now();
  state.lastResults = {
    open: unique.length,
    replied: results.filter((r) => r.ok).length,
    at: new Date().toISOString(),
  };
  saveState(state);

  if (results.some((r) => r.ok)) {
    pushStatusEvent(
      `followup scan · ${results.filter((r) => r.ok).length} replied · ${unique.length} open`,
    );
  } else if (unique.length === 0) {
    pushStatusEvent("followup scan · clear");
  }

  return {
    scanned: true,
    open: unique.length,
    replied: results.filter((r) => r.ok).length,
    held,
    results,
  };
}
