/**
 * Shared Ava post helpers — Discord + Slack — always record training logs.
 * Prefer these from one-shot scripts / agent-directed posts.
 */
import { loadEnv, botToken, slackBotToken, telegramBotToken } from "./config.mjs";
import {
  makeFetchJson,
  postMessage as discordPostMessage,
  editMessage as discordEditMessage,
} from "./discordApi.mjs";
import { isSlackChannelId } from "./slackGateway.mjs";
import {
  telegramSendMessage,
  telegramChatIdFromChannel,
  isTelegramChannelId,
  toTelegramChannelId,
} from "./telegramApi.mjs";
import { recordAvaUtterance } from "./fullLog.mjs";
import { createAckReactor } from "./ackReact.mjs";
import { splitSlackContent, sleep } from "./splitContent.mjs";
import { scrubPublicReply } from "./scrub.mjs";
import { maybeSeedProposalReactions } from "./seedVoteReactions.mjs";

async function makeAckReactor({ env, token, slackToken } = {}) {
  const e = env || (await loadEnv());
  const discordTok = token || botToken(e);
  const slackTok = slackToken || slackBotToken(e);
  return createAckReactor({
    fetchJson: discordTok ? makeFetchJson(discordTok) : null,
    slackClient: slackTok
      ? {
          reactions: {
            add: async (args) =>
              fetch("https://slack.com/api/reactions.add", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${slackTok}`,
                  "Content-Type": "application/json; charset=utf-8",
                },
                body: JSON.stringify(args),
              }).then((r) => r.json()),
            remove: async (args) =>
              fetch("https://slack.com/api/reactions.remove", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${slackTok}`,
                  "Content-Type": "application/json; charset=utf-8",
                },
                body: JSON.stringify(args),
              }).then((r) => r.json()),
          },
        }
      : null,
  });
}

async function ackParentBeforeReply({
  channelId,
  refId,
  env,
  token,
  slackToken,
  ackReact = true,
}) {
  if (!ackReact || !refId || !channelId) return null;
  try {
    const reactor = await makeAckReactor({ env, token, slackToken });
    // ⏱️ seen+recorded; ✏️ while this reply posts (cleared after send)
    await reactor.reactStored(channelId, refId);
    await reactor.reactWriting(channelId, refId);
    return reactor;
  } catch (err) {
    console.warn("ack parent react:", err.message);
    return null;
  }
}

export async function postAvaDiscord({
  channelId,
  content,
  refId = null,
  kind = "operator_directed",
  source = "agent",
  user = null,
  authorId = null,
  authorName = null,
  env = null,
  token = null,
  ackReact = true,
  /** Force on/off; default auto-detects PROP/vote posts */
  seedVoteReactions = null,
} = {}) {
  const e = env || (await loadEnv());
  const t = token || botToken(e);
  const reactor = await ackParentBeforeReply({
    channelId,
    refId,
    env: e,
    token: t,
    ackReact,
  });
  try {
    const fetchJson = makeFetchJson(t);
    const longOk =
      kind === "operator_directed" ||
      kind === "changelog" ||
      kind === "proposal" ||
      kind === "full_update" ||
      kind === "solar" ||
      String(kind || "").startsWith("solar_");
    const cleaned = scrubPublicReply(content, {
      surface: "discord",
      allowLongProp: longOk,
      maxChars: longOk ? 1900 : undefined,
    });
    // Multipost — same as RootMC Official report splitter
    const msg = await discordPostMessage(fetchJson, channelId, cleaned, refId);
    if (refId && reactor) await reactor.clearWriting(channelId, refId);
    if (msg?.id) {
      await maybeSeedProposalReactions(fetchJson, {
        channelId,
        messageId: msg.id,
        kind,
        content: cleaned,
        seedVoteReactions,
      });
    }
    recordAvaUtterance({
      surface: "discord",
      channelId,
      content: cleaned,
      refId,
      kind,
      source,
      ok: true,
      messageId: msg?.id || null,
      user,
      authorId,
      authorName,
      meta: msg?._avaParts ? { parts: msg._avaParts } : undefined,
    });
    return msg;
  } catch (err) {
    if (refId && reactor) await reactor.clearWriting(channelId, refId).catch(() => {});
    recordAvaUtterance({
      surface: "discord",
      channelId,
      content,
      refId,
      kind,
      source,
      ok: false,
      error: err.message,
      user,
      authorId,
      authorName,
    });
    throw err;
  }
}

export async function postAvaSlack({
  channelId,
  content,
  threadTs = null,
  kind = "operator_directed",
  source = "agent",
  user = null,
  authorId = null,
  authorName = null,
  env = null,
  token = null,
  ackReact = true,
} = {}) {
  const e = env || (await loadEnv());
  const t = token || slackBotToken(e);
  if (!t) throw new Error("missing AVA_SLACK_BOT_TOKEN");

  const parentTs = threadTs || null;
  const reactor = await ackParentBeforeReply({
    channelId,
    refId: parentTs,
    env: e,
    slackToken: t,
    ackReact,
  });

  const parts = splitSlackContent(String(content || ""));
  const chunks = parts.length ? parts : [""];

  try {
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
          Authorization: `Bearer ${t}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(payload),
      }).then((r) => r.json());

      if (!data.ok) {
        recordAvaUtterance({
          surface: "slack",
          channelId,
          content,
          refId: threadTs,
          kind,
          source,
          ok: false,
          error: data.error || "slack_post_failed",
          user,
          authorId,
          authorName,
        });
        throw new Error(data.error || "slack_post_failed");
      }
      if (!first) first = data;
      if (i < chunks.length - 1) await sleep(350);
    }
    if (parentTs && reactor) await reactor.clearWriting(channelId, parentTs);
    recordAvaUtterance({
      surface: "slack",
      channelId,
      content,
      refId: threadTs,
      kind,
      source,
      ok: true,
      messageId: first?.ts || null,
      user,
      authorId,
      authorName,
      meta: chunks.length > 1 ? { parts: chunks.length } : undefined,
    });
    return first;
  } catch (err) {
    if (parentTs && reactor) await reactor.clearWriting(channelId, parentTs).catch(() => {});
    throw err;
  }
}

/** Route by channel id shape. */
export async function postAvaTelegram({
  chatId,
  content,
  replyToMessageId = null,
  kind = "operator_directed",
  source = "agent",
  user = null,
  authorId = null,
  authorName = null,
  env = null,
} = {}) {
  const e = env || (await loadEnv());
  if (!telegramBotToken(e)) throw new Error("missing AVA_TELEGRAM_BOT_TOKEN");
  const channelId = isTelegramChannelId(chatId)
    ? String(chatId)
    : toTelegramChannelId(chatId);
  const cleaned = scrubPublicReply(content, { surface: "telegram" });
  const parts = String(cleaned || "").match(/[\s\S]{1,4000}/g) || [""];
  try {
    let first = null;
    for (let i = 0; i < parts.length; i++) {
      const sent = await telegramSendMessage(
        telegramChatIdFromChannel(channelId),
        parts[i],
        {
          replyToMessageId: i === 0 ? replyToMessageId : null,
          env: e,
        },
      );
      if (!first) first = sent;
    }
    recordAvaUtterance({
      surface: "telegram",
      channelId,
      content: cleaned,
      refId: replyToMessageId ? String(replyToMessageId) : null,
      kind,
      source,
      ok: true,
      messageId: first?.message_id ? String(first.message_id) : null,
      user,
      authorId,
      authorName,
    });
    return { id: String(first?.message_id || ""), ...first };
  } catch (err) {
    recordAvaUtterance({
      surface: "telegram",
      channelId,
      content: cleaned,
      kind,
      source,
      ok: false,
      error: err.message,
      user,
      authorId,
      authorName,
    });
    throw err;
  }
}

/** Route by channel id shape. */
export async function postAva(opts = {}) {
  const channelId = opts.channelId;
  if (isTelegramChannelId(channelId) || opts.telegram) {
    return postAvaTelegram({
      ...opts,
      chatId: channelId || opts.chatId,
      replyToMessageId: opts.refId || opts.replyToMessageId || null,
    });
  }
  if (isSlackChannelId(channelId)) {
    return postAvaSlack({
      ...opts,
      threadTs: opts.threadTs || opts.refId || null,
    });
  }
  return postAvaDiscord(opts);
}

/**
 * Edit Ava's own Discord post. Always allowed for her messages.
 * Prefer edit over a second correction post when fixing typos / emoji / facts.
 */
export async function editAvaDiscord({
  channelId,
  messageId,
  content,
  kind = "edit",
  source = "agent",
  env = null,
  token = null,
} = {}) {
  if (!channelId || !messageId) throw new Error("channelId and messageId required");
  const e = env || (await loadEnv());
  const t = token || botToken(e);
  const fetchJson = makeFetchJson(t);
  const cleaned = scrubPublicReply(content, { surface: "discord" });
  try {
    const msg = await discordEditMessage(fetchJson, channelId, messageId, cleaned);
    recordAvaUtterance({
      surface: "discord",
      channelId,
      content: cleaned,
      refId: null,
      kind,
      source,
      ok: true,
      messageId: msg?.id || messageId,
      meta: { edited: true },
    });
    return msg;
  } catch (err) {
    recordAvaUtterance({
      surface: "discord",
      channelId,
      content: cleaned,
      kind,
      source,
      ok: false,
      error: err.message,
      messageId,
      meta: { edited: true },
    });
    throw err;
  }
}
