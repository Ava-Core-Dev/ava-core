/**
 * Full channel dumps → text files + Telegram (operator only).
 * Same shape as the Aug 2 morning dump the operator liked.
 */
import fs from "node:fs";
import path from "node:path";
import {
  loadEnv,
  botToken,
  slackBotToken,
  telegramBotToken,
  DISCORD_API,
  ROOTMC_GUILD_ID,
  AVA_BOT_APP_ID,
} from "../src/config.mjs";
import { authHeaders } from "../src/discordApi.mjs";

const DAY = new Date().toISOString().slice(0, 10);
const OUT_DIR = `E:\\.Ava_Ivy\\reports\\channel-dumps-${DAY}-resweep`;
const SLACK_CHANNELS = [
  ["C0BLTNDJB4M", "plugins"],
  ["C0BLQ5C342F", "new-channel"],
  ["C0BM0N1MUJY", "work-log"],
  ["C0BLYV4SA6M", "decisions"],
  ["C0BLT3B9RQV", "social"],
  ["C0BLWBTUCR0", "all-rootmc"],
  ["C0BLV24TVP0", "ops-feed"],
  ["C0BM6KVFS0L", "automated-reports"],
  ["C0BMRPDUH0Q", "shockbyte-status"],
  ["C0BM4B4RT8S", "overview"],
  ["C0BLMGBVAMD", "feedback"],
  ["C0BMX0QKSTS", "server-logs"],
  ["C0BLZCVAC3X", "plugin-sales"],
  ["C0BLY49H13M", "server-reports"],
  ["C0BM6HN0WMA", "api-description"],
  ["C0BMDLAS5QS", "--general-chat--"],
  ["C0BM4QT5U0Z", "discord-channels"],
  ["C0BLMHKTCTH", "crons-automation"],
  ["C0BMCPMDDQR", "development-feed"],
  ["C0BM4P3GVDX", "new-plugin-development-plans"],
];

const DISCORD_MSG_LIMIT = 200;
const SLACK_MSG_LIMIT = 200;

fs.mkdirSync(path.join(OUT_DIR, "discord"), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, "slack"), { recursive: true });

const env = await loadEnv();
const discordHeaders = authHeaders(botToken(env));
const slackToken = slackBotToken(env);
const tgToken = telegramBotToken(env);
const tgChat = String(
  env.AVA_TELEGRAM_OPERATOR_IDS || process.env.AVA_TELEGRAM_OPERATOR_IDS || "",
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)[0];

function safeName(name) {
  return (
    String(name || "unknown")
      .replace(/[^\w.\-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "unknown"
  );
}

function tsIso(ms) {
  try {
    return new Date(Number(ms)).toISOString();
  } catch {
    return String(ms);
  }
}

async function discordFetch(p) {
  const res = await fetch(`${DISCORD_API}${p}`, { headers: discordHeaders });
  const text = await res.text();
  if (!res.ok) throw new Error(`discord ${p} ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function slackApi(method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${slackToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function dumpDiscordChannel(ch) {
  const lines = [
    `# Discord #${ch.name}`,
    `id: ${ch.id}`,
    `topic: ${(ch.topic || "").replace(/\n/g, " ")}`,
    `dumped_at: ${new Date().toISOString()}`,
    `limit: ${DISCORD_MSG_LIMIT}`,
    "",
    "=".repeat(72),
    "",
  ];
  const collected = [];
  let before = null;
  while (collected.length < DISCORD_MSG_LIMIT) {
    const q = before ? `?limit=100&before=${before}` : `?limit=100`;
    let batch;
    try {
      batch = await discordFetch(`/channels/${ch.id}/messages${q}`);
    } catch (err) {
      lines.push(`ERROR: ${err.message}`);
      break;
    }
    if (!Array.isArray(batch) || !batch.length) break;
    collected.push(...batch);
    before = batch[batch.length - 1].id;
    if (batch.length < 100) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  collected.reverse();
  const slice = collected.slice(-DISCORD_MSG_LIMIT);
  for (const m of slice) {
    const when = tsIso(Number((BigInt(m.id) >> 22n) + 1420070400000n));
    const isAva = m.author?.id === AVA_BOT_APP_ID;
    const who = isAva
      ? "Ava"
      : m.author?.bot
        ? `[bot] ${m.author.username}`
        : `${m.author?.username || "?"} (${m.author?.id || ""})`;
    const att = (m.attachments || [])
      .map((a) => `[file:${a.filename || "att"} ${a.url || ""}]`)
      .join(" ");
    const ref = m.message_reference?.message_id
      ? ` (reply-to ${m.message_reference.message_id})`
      : "";
    lines.push(`--- ${when} | ${who}${ref}`);
    lines.push(String(m.content || "(no text)") + (att ? `\n${att}` : ""));
    lines.push("");
  }
  lines.push("=".repeat(72), `message_count: ${slice.length}`);
  const file = path.join(OUT_DIR, "discord", `${safeName(ch.name)}_${ch.id}.txt`);
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return { file, name: ch.name, id: ch.id, count: slice.length };
}

async function dumpSlackChannel(id, name) {
  const lines = [
    `# Slack #${name}`,
    `id: ${id}`,
    `dumped_at: ${new Date().toISOString()}`,
    `limit: ${SLACK_MSG_LIMIT}`,
    "",
    "=".repeat(72),
    "",
  ];
  await slackApi("conversations.join", { channel: id }).catch(() => null);
  const collected = [];
  let cursor = undefined;
  while (collected.length < SLACK_MSG_LIMIT) {
    const data = await slackApi("conversations.history", {
      channel: id,
      limit: 100,
      cursor,
    });
    if (!data.ok) {
      lines.push(`ERROR: ${data.error || "history_failed"}`);
      break;
    }
    const msgs = data.messages || [];
    collected.push(...msgs);
    cursor = data.response_metadata?.next_cursor;
    if (!cursor || !msgs.length) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  const slice = collected.slice(0, SLACK_MSG_LIMIT).reverse();
  for (const m of slice) {
    const when = tsIso(Number(m.ts) * 1000);
    const who = m.bot_id
      ? `[bot] ${m.username || m.bot_profile?.name || m.bot_id}`
      : `user:${m.user || "?"}`;
    const thread =
      m.thread_ts && m.thread_ts !== m.ts ? ` (thread ${m.thread_ts})` : "";
    const files = (m.files || [])
      .map((f) => `[file:${f.name || f.title || "att"}]`)
      .join(" ");
    lines.push(`--- ${when} | ${who}${thread}`);
    lines.push(String(m.text || "(no text)") + (files ? `\n${files}` : ""));
    lines.push("");
  }
  lines.push("=".repeat(72), `message_count: ${slice.length}`);
  const file = path.join(OUT_DIR, "slack", `${safeName(name)}_${id}.txt`);
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return { file, name, id, count: slice.length };
}

async function telegramSendDocument(chatId, filePath, caption = "") {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption.slice(0, 1024));
  const buf = fs.readFileSync(filePath);
  form.append(
    "document",
    new Blob([buf], { type: "text/plain" }),
    path.basename(filePath),
  );
  const res = await fetch(`https://api.telegram.org/bot${tgToken}/sendDocument`, {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || "sendDocument_failed");
  return data.result;
}

async function telegramSendMessage(chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: String(text).slice(0, 4000),
      disable_web_page_preview: true,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || "sendMessage_failed");
}

console.log("discord: listing…");
const allCh = await discordFetch(`/guilds/${ROOTMC_GUILD_ID}/channels`);
const textChannels = (Array.isArray(allCh) ? allCh : [])
  .filter((c) => c.type === 0)
  .sort((a, b) => String(a.name).localeCompare(String(b.name)));

const discordResults = [];
for (const ch of textChannels) {
  process.stdout.write(`discord #${ch.name}… `);
  try {
    const r = await dumpDiscordChannel(ch);
    console.log(r.count);
    discordResults.push(r);
  } catch (err) {
    console.log("FAIL", err.message);
    discordResults.push({ name: ch.name, id: ch.id, error: err.message, count: 0 });
  }
  await new Promise((r) => setTimeout(r, 200));
}

console.log("slack: dumping…");
const slackResults = [];
for (const [id, name] of SLACK_CHANNELS) {
  process.stdout.write(`slack #${name}… `);
  try {
    const r = await dumpSlackChannel(id, name);
    console.log(r.count);
    slackResults.push(r);
  } catch (err) {
    console.log("FAIL", err.message);
    slackResults.push({ name, id, error: err.message, count: 0 });
  }
}

const indexLines = [
  `Ava FULL re-sweep — ${new Date().toISOString()}`,
  `Folder: ${OUT_DIR}`,
  ``,
  `DISCORD (${discordResults.length} channels)`,
  ...discordResults.map(
    (r) =>
      `- #${r.name} (${r.id}) msgs=${r.count}${r.error ? ` ERROR=${r.error}` : ""}`,
  ),
  ``,
  `SLACK (${slackResults.length} channels)`,
  ...slackResults.map(
    (r) =>
      `- #${r.name} (${r.id}) msgs=${r.count}${r.error ? ` ERROR=${r.error}` : ""}`,
  ),
  ``,
];
const indexPath = path.join(OUT_DIR, "00-INDEX.txt");
fs.writeFileSync(indexPath, indexLines.join("\n"), "utf8");

const masterPath = path.join(OUT_DIR, "00-MASTER-ALL-CHANNELS.txt");
const masterParts = [indexLines.join("\n"), "", "# ===== FULL DUMPS =====", ""];
for (const r of [...discordResults, ...slackResults]) {
  if (!r.file || !fs.existsSync(r.file)) continue;
  masterParts.push("", "#".repeat(72), fs.readFileSync(r.file, "utf8"));
}
fs.writeFileSync(masterPath, masterParts.join("\n"), "utf8");

const discordBundle = path.join(OUT_DIR, "01-DISCORD-ALL.txt");
const slackBundle = path.join(OUT_DIR, "02-SLACK-ALL.txt");
fs.writeFileSync(
  discordBundle,
  discordResults
    .filter((r) => r.file && fs.existsSync(r.file))
    .map((r) => fs.readFileSync(r.file, "utf8"))
    .join("\n\n" + "#".repeat(72) + "\n\n"),
  "utf8",
);
fs.writeFileSync(
  slackBundle,
  slackResults
    .filter((r) => r.file && fs.existsSync(r.file))
    .map((r) => fs.readFileSync(r.file, "utf8"))
    .join("\n\n" + "#".repeat(72) + "\n\n"),
  "utf8",
);

console.log("master bytes", fs.statSync(masterPath).size);

if (tgToken && tgChat) {
  await telegramSendMessage(
    tgChat,
    `Ava — full channel re-sweep done\n${OUT_DIR}\nFiles follow.`,
  );
  await telegramSendDocument(tgChat, indexPath, "FULL re-sweep INDEX");
  await new Promise((r) => setTimeout(r, 400));
  await telegramSendDocument(
    tgChat,
    masterPath,
    `MASTER all channels (${Math.round(fs.statSync(masterPath).size / 1024)} KB)`,
  );
  await new Promise((r) => setTimeout(r, 400));
  await telegramSendDocument(
    tgChat,
    discordBundle,
    `Discord ALL (${Math.round(fs.statSync(discordBundle).size / 1024)} KB)`,
  );
  await new Promise((r) => setTimeout(r, 400));
  await telegramSendDocument(
    tgChat,
    slackBundle,
    `Slack ALL (${Math.round(fs.statSync(slackBundle).size / 1024)} KB)`,
  );
  console.log("telegram ok", tgChat);
}

console.log("done", OUT_DIR);
