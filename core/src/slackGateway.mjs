/**
 * Slack Socket Mode transport — staff dig core (#development-feed, plans).
 * Maps Slack events into the Discord-shaped pipeline message.
 * On join: auto-archive full channel history locally.
 */
import { App } from "@slack/bolt";
import {
  slackBotToken,
  slackAppToken,
  slackWatchChannels,
  slackBotUserId,
} from "./config.mjs";
import {
  archiveSlackChannel,
  archiveAllJoinedSlackChannels,
} from "./slackChannelArchive.mjs";
import { refersToAva } from "./recommend.mjs";
import { recordAvaUtterance } from "./fullLog.mjs";
import { ingestSlackMessageReactions } from "./reactionStore.mjs";

/**
 * @param {{
 *   onMessage: (msg: object, meta?: object) => void | Promise<void>,
 *   onReady?: (info: object) => void,
 *   onChannelJoined?: (info: object) => void | Promise<void>,
 *   watchIds?: string[],
 *   archiveOnReady?: boolean,
 * }} opts
 */
export function startSlackGateway({
  onMessage,
  onReady,
  onChannelJoined,
  watchIds,
  archiveOnReady = true,
} = {}) {
  const botToken = slackBotToken();
  const appToken = slackAppToken();
  if (!botToken || !appToken) {
    console.warn(
      "Ava Slack: AVA_SLACK_BOT_TOKEN / AVA_SLACK_APP_TOKEN missing — Slack dig core offline",
    );
    return {
      stop() {},
      ready: false,
      postMessage: async () => {
        throw new Error("slack_not_configured");
      },
      botUserId: null,
    };
  }

  const watch = new Set(
    (watchIds?.length ? watchIds : slackWatchChannels()).map(String).filter(Boolean),
  );

  let botUserId = slackBotUserId() || null;
  let started = false;

  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
  });

  async function postMessage(channelId, text, threadTs = null, opts = {}) {
    const { splitSlackContent, sleep } = await import("./splitContent.mjs");
    const parts = splitSlackContent(String(text || ""));
    const chunks = parts.length ? parts : [""];
    let first = null;
    try {
      for (let i = 0; i < chunks.length; i++) {
        const payload = {
          channel: String(channelId),
          text: chunks[i].slice(0, 3900),
          unfurl_links: false,
          unfurl_media: false,
        };
        // Keep thread; only first part needs parent ts for new replies
        if (threadTs) payload.thread_ts = String(threadTs);
        const result = await app.client.chat.postMessage(payload);
        if (!first) first = result;
        if (i < chunks.length - 1) await sleep(350);
      }
      // Pipeline reply wrapper also records — skip when caller already logs
      if (!opts.skipLog) {
        recordAvaUtterance({
          surface: "slack",
          channelId,
          content: text,
          refId: threadTs,
          kind: opts.kind || "reply",
          source: opts.source || "slack-gateway",
          ok: true,
          messageId: first?.ts || null,
          user: opts.user || null,
          authorId: opts.authorId || null,
          meta: chunks.length > 1 ? { parts: chunks.length } : undefined,
        });
      }
      return first;
    } catch (err) {
      if (!opts.skipLog) {
        recordAvaUtterance({
          surface: "slack",
          channelId,
          content: text,
          refId: threadTs,
          kind: opts.kind || "reply",
          source: opts.source || "slack-gateway",
          ok: false,
          error: err.message,
        });
      }
      throw err;
    }
  }

  function toPipelineMsg(event, userInfo) {
    const text = String(event.text || "")
      .replace(/<@([A-Z0-9]+)>(\s*)/gi, (_, id, sp) =>
        botUserId && id === botUserId ? `ava${sp || " "}` : `@${id}${sp || ""}`,
      )
      .replace(/<#([A-Z0-9]+)(?:\|[^>]*)?>/g, "#$1")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");

    const mentions = [];
    if (botUserId && /<@[A-Z0-9]+>/i.test(String(event.text || ""))) {
      const re = /<@([A-Z0-9]+)>/gi;
      let m;
      while ((m = re.exec(String(event.text || "")))) {
        if (m[1] === botUserId) {
          mentions.push({ id: botUserId, username: "Ava Ivy", bot: true });
        }
      }
    }

    return {
      id: String(event.ts || `${Date.now()}`),
      channel_id: String(event.channel),
      content: text,
      author: {
        id: String(event.user || userInfo?.id || "unknown"),
        username:
          userInfo?.profile?.display_name ||
          userInfo?.name ||
          String(event.user || "slack"),
        bot: false,
      },
      mentions,
      surface: "slack",
      thread_ts: event.thread_ts || null,
      // Slack ts doubles as reply parent when threading to the ask
      referenced_message: null,
    };
  }

  async function handleEvent(event) {
    if (!event || event.bot_id || event.subtype === "bot_message") return;
    if (event.subtype && event.subtype !== "file_share") return;
    if (!event.user || !event.text) return;
    if (botUserId && event.user === botUserId) return;
    const ch = String(event.channel || "");
    // Dig watch list OR any channel where someone names/talks about Ava
    const aboutHer = refersToAva(event.text, botUserId);
    if (watch.size && !watch.has(ch) && !aboutHer) return;

    let userInfo = null;
    try {
      const r = await app.client.users.info({ user: event.user });
      userInfo = r.user;
    } catch {
      /* ignore */
    }

    const msg = toPipelineMsg(event, userInfo);
    // Mentions of Ava or name trigger — also any message in dig channels that @ava / starts with ava
    await onMessage?.(msg, { surface: "slack", channelId: ch });
  }

  app.event("message", async ({ event }) => {
    try {
      await handleEvent(event);
    } catch (err) {
      console.warn("slack message:", err.message);
    }
  });

  app.event("app_mention", async ({ event }) => {
    try {
      await handleEvent(event);
    } catch (err) {
      console.warn("slack mention:", err.message);
    }
  });

  // Live reaction feedback on Ava's Slack posts
  async function harvestReactionEvent(event) {
    if (!event?.item || event.item.type !== "message") return;
    if (!botUserId || event.item_user !== botUserId) return;
    const channelId = String(event.item.channel || "");
    const ts = String(event.item.ts || "");
    if (!channelId || !ts) return;
    try {
      const hist = await app.client.conversations.history({
        channel: channelId,
        latest: ts,
        inclusive: true,
        limit: 1,
      });
      const m = hist.messages?.[0];
      if (!m || m.ts !== ts) return;
      ingestSlackMessageReactions({
        message: { ...m, __forceAva: true },
        channelId,
        avaBotUserId: botUserId,
      });
    } catch (err) {
      console.warn("slack reaction harvest:", err.message);
    }
  }

  app.event("reaction_added", async ({ event }) => {
    try {
      await harvestReactionEvent(event);
    } catch (err) {
      console.warn("slack reaction_added:", err.message);
    }
  });

  app.event("reaction_removed", async ({ event }) => {
    try {
      await harvestReactionEvent(event);
    } catch (err) {
      console.warn("slack reaction_removed:", err.message);
    }
  });

  // Ava (or anyone — we only act when it's us) lands in a channel → save everything already there
  app.event("member_joined_channel", async ({ event }) => {
    try {
      if (!event?.channel || !event?.user) return;
      if (botUserId && event.user !== botUserId) return;
      const channelId = String(event.channel);
      watch.add(channelId);
      console.log("Ava joined Slack channel", channelId, "— archiving history");
      const summary = await archiveSlackChannel(app.client, channelId, {
        force: false,
      });
      await onChannelJoined?.({
        channelId,
        summary,
        botUserId,
      });
    } catch (err) {
      console.warn("slack member_joined_channel:", err.message);
    }
  });

  const startPromise = (async () => {
    await app.start();
    started = true;
    try {
      const auth = await app.client.auth.test();
      botUserId = auth.user_id || botUserId;
    } catch (err) {
      console.warn("slack auth.test:", err.message);
    }
    console.log(
      "Ava Slack Socket Mode ready",
      botUserId ? `as ${botUserId}` : "",
      `watching ${watch.size} channel(s)`,
    );
    onReady?.({ botUserId, watch: [...watch] });

    // Backfill: any channel she's already in but hasn't archived yet
    if (archiveOnReady) {
      setTimeout(() => {
        archiveAllJoinedSlackChannels(app.client, { force: false })
          .then((results) => {
            const n = results.filter((r) => r.messages > 0).length;
            const skipped = results.filter((r) => r.skipped).length;
            console.log(
              `slack archive backfill · ${n} new · ${skipped} already saved · ${results.length} member channels`,
            );
          })
          .catch((err) => console.warn("slack archive backfill:", err.message));
      }, 2500);
    }
  })().catch((err) => {
    console.error("Ava Slack failed to start:", err.message);
  });

  return {
    ready: true,
    startPromise,
    get botUserId() {
      return botUserId;
    },
    get client() {
      return app.client;
    },
    addWatch(id) {
      if (id) watch.add(String(id));
    },
    archiveChannel(channelId, opts) {
      return archiveSlackChannel(app.client, channelId, opts);
    },
    postMessage,
    async stop() {
      try {
        if (started) await app.stop();
      } catch (err) {
        console.warn("slack stop:", err.message);
      }
      started = false;
    },
  };
}

export function isSlackChannelId(id) {
  return /^[CGD][A-Z0-9]+$/i.test(String(id || ""));
}
