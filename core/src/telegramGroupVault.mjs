/**
 * Per-Telegram-group private vault — memory/notes stay under that chat only.
 * No cross-group reads. Group digs do not go to global training by default.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import { telegramChatIdFromChannel, isTelegramChannelId } from "./telegramApi.mjs";

const ALEX_TG = "6644482344";

function groupsRoot() {
  const dir = path.join(storePaths().dir, "telegram", "groups");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function isTelegramGroupChannel(channelId, chatType = null) {
  if (chatType && chatType !== "private") return true;
  if (!isTelegramChannelId(channelId)) return false;
  const id = String(telegramChatIdFromChannel(channelId));
  return id.startsWith("-");
}

export function groupVaultId(chatIdOrChannel) {
  const id = isTelegramChannelId(chatIdOrChannel)
    ? telegramChatIdFromChannel(chatIdOrChannel)
    : String(chatIdOrChannel || "");
  return String(id);
}

function vaultDir(chatIdOrChannel) {
  const id = groupVaultId(chatIdOrChannel);
  const dir = path.join(groupsRoot(), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "notes"), { recursive: true });
  return dir;
}

function metaPath(chatIdOrChannel) {
  return path.join(vaultDir(chatIdOrChannel), "meta.json");
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

function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
}

export function loadGroupMeta(chatIdOrChannel) {
  return readJson(metaPath(chatIdOrChannel), {
    chatId: groupVaultId(chatIdOrChannel),
    title: null,
    chatType: null,
    joinedAt: null,
    installApproved: false,
    installApprovedAt: null,
    installApprovedBy: null,
    installBrief: null,
    updatedAt: 0,
  });
}

export function touchGroupVault({
  chatId,
  title = null,
  chatType = null,
  event = "touch",
  fromId = null,
  preview = null,
} = {}) {
  if (!chatId) return null;
  const meta = loadGroupMeta(chatId);
  meta.chatId = groupVaultId(chatId);
  if (title) meta.title = title;
  if (chatType) meta.chatType = chatType;
  if (!meta.joinedAt) meta.joinedAt = Date.now();
  meta.updatedAt = Date.now();
  meta.lastEvent = event;
  if (fromId) meta.lastFromId = String(fromId);
  writeJson(metaPath(chatId), meta);

  if (preview) {
    appendJsonl(path.join(vaultDir(chatId), "inbound.jsonl"), {
      at: Date.now(),
      event,
      fromId: fromId ? String(fromId) : null,
      preview: String(preview).slice(0, 2000),
    });
  }
  return meta;
}

export function isGroupInstallApproved(chatIdOrChannel) {
  return Boolean(loadGroupMeta(chatIdOrChannel).installApproved);
}

export function approveGroupInstall(chatIdOrChannel, { by, brief = null } = {}) {
  const meta = loadGroupMeta(chatIdOrChannel);
  meta.installApproved = true;
  meta.installApprovedAt = Date.now();
  meta.installApprovedBy = by ? String(by) : ALEX_TG;
  if (brief) meta.installBrief = String(brief).slice(0, 4000);
  meta.updatedAt = Date.now();
  writeJson(metaPath(chatIdOrChannel), meta);
  appendJsonl(path.join(vaultDir(chatIdOrChannel), "notes", "install.jsonl"), {
    at: Date.now(),
    kind: "approved",
    by: meta.installApprovedBy,
    brief: meta.installBrief,
  });
  return meta;
}

/** Append a group-private dig — never call for other groups' context. */
export function logGroupDig(chatIdOrChannel, { question, answer, authorId, messageId, meta = {} } = {}) {
  appendJsonl(path.join(vaultDir(chatIdOrChannel), "digs.jsonl"), {
    at: Date.now(),
    question: String(question || "").slice(0, 4000),
    answer: String(answer || "").slice(0, 4000),
    authorId: authorId || null,
    messageId: messageId || null,
    ...meta,
  });
}

export function rememberGroupLine(chatIdOrChannel, { authorId, authorName, content } = {}) {
  if (!content) return;
  appendJsonl(path.join(vaultDir(chatIdOrChannel), "memory.jsonl"), {
    at: Date.now(),
    authorId: authorId || null,
    authorName: authorName || null,
    content: String(content).slice(0, 1000),
  });
}

/** Recent memory for THIS group only (no cross-group bleed). */
export function groupMemoryContext(chatIdOrChannel, { limit = 12 } = {}) {
  const file = path.join(vaultDir(chatIdOrChannel), "memory.jsonl");
  if (!fs.existsSync(file)) return "";
  const lines = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit);
  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  if (!rows.length) return "";
  return (
    "Earlier in THIS Telegram group only (private vault — do not cite other chats):\n" +
    rows
      .map((r) => `${r.authorName || r.authorId || "?"}: ${r.content}`)
      .join("\n")
  );
}

export function markInstallAskSent(chatIdOrChannel, { pendingBrief = null } = {}) {
  const meta = loadGroupMeta(chatIdOrChannel);
  meta.installAskSent = true;
  if (pendingBrief) meta.pendingInstallBrief = String(pendingBrief).slice(0, 4000);
  meta.updatedAt = Date.now();
  writeJson(metaPath(chatIdOrChannel), meta);
  return meta;
}

export function looksLikeInstallGo(text) {
  const t = String(text || "");
  return (
    /\b(install\s+(go|ok|yes|approved)|approve\s+install|greenlight\s+install|you'?re?\s+good\s+to\s+install|go\s+ahead\s+and\s+install)\b/i.test(
      t,
    ) ||
    /\beverything\s+that'?s\s+best\b/i.test(t) ||
    /\byou\s+know\s+how\s+i\s+like\s+things\b/i.test(t) ||
    /\b(full\s+install|install\s+full|best\s+scopes?|full\s+scopes?)\b/i.test(t)
  );
}

export function looksLikeInstallBrief(text) {
  return /\b(install|scope|permission|vault|remember|enable)\b/i.test(
    String(text || ""),
  );
}

export function isAlexTelegramId(authorId) {
  const id = String(authorId || "");
  if (id === ALEX_TG) return true;
  const extra = String(process.env.AVA_TELEGRAM_OPERATOR_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return extra.includes(id);
}
