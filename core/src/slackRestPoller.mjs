/**
 * Slack REST poller — used when Socket Mode (AVA_SLACK_APP_TOKEN) is offline
 * so Ava still sees @mentions on watch channels within seconds, not minutes.
 */
import { slackBotToken, slackBotUserId, slackWatchChannels } from "./config.mjs";
import { looksLikeAvaTrigger, looksLikeTalkingAboutAva } from "./recommend.mjs";

function slackAddressesAva(text, botId) {
  if (looksLikeAvaTrigger(text, botId) || looksLikeTalkingAboutAva(text, botId)) {
    return true;
  }
  return Boolean(botId && String(text || "").includes(`<@${botId}>`));
}

async function slackGet(token, method, params = {}) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`https://slack.com/api/${method}?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

/**
 * @param {{
 *   onMessage: (msg: object) => void | Promise<void>,
 *   watchIds?: string[],
 *   botUserId?: string,
 *   intervalMs?: number,
 *   seenHas?: (key: string) => boolean,
 * }} opts
 */
export function startSlackRestPoller(opts = {}) {
  const token = slackBotToken();
  const botUserId = opts.botUserId || slackBotUserId() || "U0BMBNYPYA2";
  if (!token) {
    console.warn("Ava Slack REST poller: AVA_SLACK_BOT_TOKEN missing");
    return { stop() {}, ready: false, botUserId: null, mode: "off" };
  }

  const watch = (opts.watchIds?.length ? opts.watchIds : slackWatchChannels())
    .map(String)
    .filter(Boolean);
  const intervalMs = Math.max(3_000, Number(opts.intervalMs || 5_000) || 5_000);
  /** @type {Map<string, string>} channelId -> newest ts seen */
  const watermarks = new Map();
  let timer = null;
  let stopped = false;
  let ticking = false;

  async function tick() {
    if (stopped || ticking) return;
    ticking = true;
    try {
      for (const channelId of watch) {
        const params = { channel: channelId, limit: "15" };
        const after = watermarks.get(channelId);
        if (after) params.oldest = after;
        const hist = await slackGet(token, "conversations.history", params);
        if (!hist.ok) {
          if (hist.error && hist.error !== "not_in_channel") {
            console.warn(`slack REST ${channelId}:`, hist.error);
          }
          continue;
        }
        const msgs = (hist.messages || [])
          .slice()
          .sort((a, b) => Number(a.ts) - Number(b.ts));
        const firstPass = !after;
        const catchupFloor = Date.now() / 1000 - 20 * 60; // last 20m on boot
        for (const m of msgs) {
          if (!m?.ts) continue;
          const prev = watermarks.get(channelId);
          if (!prev || Number(m.ts) > Number(prev)) {
            watermarks.set(channelId, m.ts);
          }
          if (m.subtype || m.bot_id || m.user === botUserId) continue;
          if (!firstPass && Number(m.ts) <= Number(after)) continue;
          // First pass: only catch recent unreplied @Ava (don't replay whole history)
          if (firstPass && Number(m.ts) < catchupFloor) continue;
          const text = String(m.text || "");
          if (!slackAddressesAva(text, botUserId)) continue;
          const key = `slack:${channelId}:${m.ts}`;
          if (opts.seenHas?.(key)) continue;

          const msg = {
            id: m.ts,
            channel_id: channelId,
            content: text,
            author: {
              id: m.user,
              username: m.user,
              bot: false,
            },
            surface: "slack",
            timestamp: Number(m.ts) * 1000,
            referenced_message: m.thread_ts ? { id: m.thread_ts } : null,
            message_reference: m.thread_ts
              ? { message_id: m.thread_ts }
              : null,
          };
          try {
            await opts.onMessage?.(msg);
          } catch (err) {
            console.warn("slack REST ingest:", err.message);
          }
        }
        if (!watermarks.has(channelId)) {
          watermarks.set(channelId, String(Date.now() / 1000));
        }
      }
    } finally {
      ticking = false;
    }
  }

  // Seed watermarks immediately, then poll
  tick().finally(() => {
    if (stopped) return;
    timer = setInterval(() => {
      tick().catch((err) => console.warn("slack REST tick:", err.message));
    }, intervalMs);
  });

  console.log(
    `Ava Slack REST poller · ${watch.length} ch · every ${Math.round(intervalMs / 1000)}s (Socket Mode offline)`,
  );

  return {
    ready: true,
    mode: "rest",
    botUserId,
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
    postMessage: async (channelId, text, threadTs = null, postOpts = {}) => {
      const { splitSlackContent, sleep } = await import("./splitContent.mjs");
      const { recordAvaUtterance } = await import("./fullLog.mjs");
      const parts = splitSlackContent(String(text || ""));
      const chunks = parts.length ? parts : [""];
      let first = null;
      for (let i = 0; i < chunks.length; i++) {
        const payload = {
          channel: String(channelId),
          text: chunks[i].slice(0, 3900),
          unfurl_links: false,
          unfurl_media: false,
        };
        if (threadTs) payload.thread_ts = String(threadTs);
        const data = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify(payload),
        }).then((r) => r.json());
        if (!data.ok) throw new Error(data.error || "slack_post_failed");
        if (!first) first = data;
        if (i < chunks.length - 1) await sleep(350);
      }
      if (!postOpts.skipLog) {
        recordAvaUtterance({
          surface: "slack",
          channelId,
          content: text,
          refId: threadTs,
          kind: postOpts.kind || "reply",
          source: postOpts.source || "slack-rest-poller",
          ok: true,
          messageId: first?.ts || null,
        });
      }
      return first;
    },
  };
}
