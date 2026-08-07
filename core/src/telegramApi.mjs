/**
 * Telegram Bot API helpers for Ava.
 * Chat ids are stored as `tg:<chatId>` so they never collide with Discord/Slack.
 */
import { telegramBotToken } from "./config.mjs";

const API = "https://api.telegram.org";

export function isTelegramChannelId(channelId) {
  return String(channelId || "").startsWith("tg:");
}

export function telegramChatIdFromChannel(channelId) {
  const s = String(channelId || "");
  if (!s.startsWith("tg:")) return s;
  return s.slice(3);
}

export function toTelegramChannelId(chatId) {
  return `tg:${chatId}`;
}

export async function telegramApi(method, body = {}, env = {}) {
  const token = telegramBotToken(env);
  if (!token) throw new Error("telegram_not_configured");
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const desc = data.description || res.statusText || "telegram_error";
    throw new Error(`${method}: ${desc}`);
  }
  return data.result;
}

export async function telegramGetMe(env = {}) {
  return telegramApi("getMe", {}, env);
}

export async function telegramDeleteWebhook(env = {}) {
  return telegramApi("deleteWebhook", { drop_pending_updates: false }, env);
}

/**
 * @returns {Promise<{ message_id: number }>}
 */
export async function telegramSendMessage(
  chatId,
  text,
  { replyToMessageId = null, env = {} } = {},
) {
  const payload = {
    chat_id: chatId,
    text: String(text || "").slice(0, 4096),
    disable_web_page_preview: true,
  };
  if (replyToMessageId) payload.reply_to_message_id = Number(replyToMessageId);
  return telegramApi("sendMessage", payload, env);
}

/**
 * Long-poll getUpdates.
 */
export async function telegramGetUpdates(
  { offset = 0, timeout = 25, env = {} } = {},
) {
  return telegramApi(
    "getUpdates",
    {
      offset,
      timeout,
      allowed_updates: ["message", "edited_message"],
    },
    env,
  );
}
