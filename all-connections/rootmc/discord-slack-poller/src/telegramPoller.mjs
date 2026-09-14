/**
 * Telegram long-poll transport — maps updates into Discord-shaped pipeline msgs.
 * Private chats: always engage. Groups: @bot /ava /start or name mention.
 */
import {
  telegramBotToken,
  telegramEnabled,
} from "./config.mjs";
import {
  telegramDeleteWebhook,
  telegramGetMe,
  telegramGetUpdates,
  telegramSendMessage,
  toTelegramChannelId,
  isTelegramChannelId,
  telegramChatIdFromChannel,
} from "./telegramApi.mjs";
import { looksLikeTalkingAboutAva } from "./recommend.mjs";

export { isTelegramChannelId, telegramChatIdFromChannel, toTelegramChannelId };

function addressesAva(text, botUsername) {
  const t = String(text || "");
  if (!t.trim()) return false;
  if (/^\/start\b/i.test(t)) return true;
  if (/^\/ava\b/i.test(t)) return true;
  if (botUsername && t.toLowerCase().includes(`@${botUsername.toLowerCase()}`)) {
    return true;
  }
  return looksLikeTalkingAboutAva(t, null) || /\bava(\s+ivy)?\b/i.test(t);
}

/**
 * @param {{
 *   onMessage: (msg: object) => void | Promise<void>,
 *   onReady?: (info: object) => void,
 *   seenHas?: (key: string) => boolean,
 *   env?: object,
 * }} opts
 */
export function startTelegramPoller(opts = {}) {
  const env = opts.env || {};
  if (!telegramEnabled(env)) {
    return {
      stop() {},
      ready: false,
      botUserId: null,
      username: null,
      postMessage: async () => {
        throw new Error("telegram_disabled");
      },
    };
  }
  const token = telegramBotToken(env);
  if (!token) {
    console.warn("Ava Telegram: AVA_TELEGRAM_BOT_TOKEN missing");
    return {
      stop() {},
      ready: false,
      botUserId: null,
      username: null,
      postMessage: async () => {
        throw new Error("telegram_not_configured");
      },
    };
  }

  let offset = 0;
  let stopped = false;
  let botUserId = null;
  let username = null;
  let loopPromise = null;

  async function postMessage(channelId, text, refId = null) {
    const chatId = telegramChatIdFromChannel(channelId);
    const parts = String(text || "").match(/[\s\S]{1,4000}/g) || [""];
    let first = null;
    for (let i = 0; i < parts.length; i++) {
      const sent = await telegramSendMessage(chatId, parts[i], {
        replyToMessageId: i === 0 ? refId : null,
        env,
      });
      if (!first) first = sent;
    }
    return { id: String(first?.message_id || ""), ts: first?.message_id };
  }

  async function handleUpdate(u) {
    const m = u.message || u.edited_message;
    if (!m || !m.chat || !m.from) return;
    if (m.from.is_bot) return;
    if (botUserId && String(m.from.id) === String(botUserId)) return;

    const chatId = m.chat.id;
    const isPrivate = m.chat.type === "private";
    const hasMedia = Boolean(
      m.photo || m.document || m.video || m.voice || m.audio || m.sticker || m.animation,
    );
    let text = String(m.text || m.caption || "");
    if (!text.trim() && hasMedia) {
      const kinds = [];
      if (m.photo) kinds.push("photo");
      if (m.document) kinds.push(`document:${m.document?.file_name || "file"}`);
      if (m.video) kinds.push("video");
      if (m.voice) kinds.push("voice");
      if (m.audio) kinds.push("audio");
      if (m.sticker) kinds.push("sticker");
      if (m.animation) kinds.push("animation");
      text = `[telegram media: ${kinds.join(", ")}]`;
    }
    if (!text.trim()) return;

    if (!isPrivate && !addressesAva(text, username)) return;

    const channelId = toTelegramChannelId(chatId);
    const msgId = String(m.message_id);
    const key = `tg:${chatId}:${msgId}`;
    if (opts.seenHas?.(key)) return;

    const msg = {
      id: msgId,
      channel_id: channelId,
      content: text.replace(/^\/ava(@\w+)?\s*/i, "").trim() || text,
      author: {
        id: String(m.from.id),
        username:
          m.from.username ||
          [m.from.first_name, m.from.last_name].filter(Boolean).join(" ") ||
          String(m.from.id),
        bot: false,
      },
      surface: "telegram",
      timestamp: (m.date || 0) * 1000,
      referenced_message: m.reply_to_message
        ? { id: String(m.reply_to_message.message_id) }
        : null,
      message_reference: m.reply_to_message
        ? { message_id: String(m.reply_to_message.message_id) }
        : null,
      telegram: {
        chatType: m.chat.type,
        chatTitle: m.chat.title || null,
        username,
      },
    };

    await opts.onMessage?.(msg);
  }

  async function loop() {
    try {
      await telegramDeleteWebhook(env);
      const me = await telegramGetMe(env);
      botUserId = String(me.id);
      username = me.username || null;
      opts.onReady?.({
        botUserId,
        username,
        name: me.first_name,
      });
    } catch (err) {
      console.warn("Ava Telegram boot:", err.message);
      return;
    }

    while (!stopped) {
      try {
        const updates = await telegramGetUpdates({
          offset,
          timeout: 25,
          env,
        });
        for (const u of updates || []) {
          if (u.update_id >= offset) offset = u.update_id + 1;
          try {
            await handleUpdate(u);
          } catch (err) {
            console.warn("telegram update:", err.message);
          }
        }
      } catch (err) {
        if (stopped) break;
        console.warn("telegram poll:", err.message);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  loopPromise = loop();

  return {
    stop() {
      stopped = true;
    },
    ready: true,
    get botUserId() {
      return botUserId;
    },
    get username() {
      return username;
    },
    postMessage,
    async waitBoot() {
      // brief wait for getMe
      for (let i = 0; i < 40 && !botUserId && !stopped; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return { botUserId, username };
    },
  };
}
