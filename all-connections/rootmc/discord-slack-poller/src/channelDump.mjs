/**
 * Incremental Discord + Slack channel dumps → text files on E.
 * Telegram delivery is OFF by default (Alex 2026-08-03: file away, still utilize).
 * Set AVA_CHANNEL_DUMP_TELEGRAM=1 to re-enable file pushes to operator Telegram.
 * Set AVA_CHANNEL_DUMP_TELEGRAM_SUMMARY=1 for a one-line path ping (no documents).
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
  AVA_HANDOFF,
} from "./config.mjs";
import { authHeaders } from "./discordApi.mjs";
import { appendAction } from "./fullLog.mjs";
import { pushStatusEvent, storePaths } from "./store.mjs";

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

/** Default every 2 hours. Override: AVA_CHANNEL_DUMP_MS */
export function channelDumpIntervalMs() {
  const n = Number(process.env.AVA_CHANNEL_DUMP_MS || "");
  if (Number.isFinite(n) && n >= 15 * 60_000) return n;
  return 2 * 60 * 60 * 1000;
}

export function channelDumpBootDelayMs() {
  const n = Number(process.env.AVA_CHANNEL_DUMP_BOOT_MS || "");
  if (Number.isFinite(n) && n >= 0) return n;
  return 5 * 60_000; // 5m after boot
}

function reportsRoot() {
  const handoff = AVA_HANDOFF || path.join(storePaths().dir, "..");
  return path.join(handoff, "reports", "channel-dumps");
}

function watermarkPath() {
  return path.join(storePaths().dir, "channel-dump-watermarks.json");
}

function loadWatermarks() {
  try {
    const p = watermarkPath();
    if (!fs.existsSync(p)) return { discord: {}, slack: {}, updatedAt: 0 };
    return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return { discord: {}, slack: {}, updatedAt: 0 };
  }
}

function saveWatermarks(wm) {
  fs.mkdirSync(path.dirname(watermarkPath()), { recursive: true });
  fs.writeFileSync(
    watermarkPath(),
    JSON.stringify({ ...wm, updatedAt: Date.now() }, null, 2),
    "utf8",
  );
}

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

function stampFolder() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function discordFetch(headers, p) {
  const res = await fetch(`${DISCORD_API}${p}`, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`discord ${res.status}: ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}

async function slackApi(token, method, body) {
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

async function telegramSendDocument(token, chatId, filePath, caption = "") {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", String(caption).slice(0, 1024));
  const buf = fs.readFileSync(filePath);
  form.append(
    "document",
    new Blob([buf], { type: "text/plain" }),
    path.basename(filePath),
  );
  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || "sendDocument_failed");
  return data.result;
}

async function telegramSendMessage(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
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

function formatDiscordMsg(m) {
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
  return [
    `--- ${when} | ${who}${ref}`,
    String(m.content || "(no text)") + (att ? `\n${att}` : ""),
    "",
  ].join("\n");
}

function formatSlackMsg(m) {
  const when = tsIso(Number(m.ts) * 1000);
  const who = m.bot_id
    ? `[bot] ${m.username || m.bot_profile?.name || m.bot_id}`
    : `user:${m.user || "?"}`;
  const thread =
    m.thread_ts && m.thread_ts !== m.ts ? ` (thread ${m.thread_ts})` : "";
  const files = (m.files || [])
    .map((f) => `[file:${f.name || f.title || "att"}]`)
    .join(" ");
  return [
    `--- ${when} | ${who}${thread}`,
    String(m.text || "(no text)") + (files ? `\n${files}` : ""),
    "",
  ].join("\n");
}

/**
 * Seed watermarks to current tips without dumping (avoids re-sending history).
 */
export async function seedChannelDumpWatermarks(opts = {}) {
  const env = opts.env || (await loadEnv());
  const headers = authHeaders(botToken(env));
  const slackTok = slackBotToken(env);
  const wm = loadWatermarks();
  wm.discord = wm.discord || {};
  wm.slack = wm.slack || {};

  const allCh = await discordFetch(
    headers,
    `/guilds/${ROOTMC_GUILD_ID}/channels`,
  );
  const textChannels = (Array.isArray(allCh) ? allCh : []).filter(
    (c) => c.type === 0,
  );
  for (const ch of textChannels) {
    try {
      const batch = await discordFetch(
        headers,
        `/channels/${ch.id}/messages?limit=1`,
      );
      if (Array.isArray(batch) && batch[0]?.id) {
        wm.discord[ch.id] = { afterId: batch[0].id, name: ch.name };
      }
    } catch {
      /* skip */
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  if (slackTok) {
    for (const [id, name] of SLACK_CHANNELS) {
      try {
        await slackApi(slackTok, "conversations.join", { channel: id });
        const data = await slackApi(slackTok, "conversations.history", {
          channel: id,
          limit: 1,
        });
        if (data.ok && data.messages?.[0]?.ts) {
          wm.slack[id] = { oldest: data.messages[0].ts, name };
        }
      } catch {
        /* skip */
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  saveWatermarks(wm);
  appendAction("channelDump.seed", {
    discord: Object.keys(wm.discord).length,
    slack: Object.keys(wm.slack).length,
  });
  return wm;
}

/**
 * Dump only new messages since watermarks. Telegram if any new content.
 * @returns {Promise<{ ok: boolean, newCount: number, dir?: string, skipped?: boolean }>}
 */
export async function runIncrementalChannelDump(opts = {}) {
  const env = opts.env || (await loadEnv());
  const headers = authHeaders(botToken(env));
  const slackTok = slackBotToken(env);
  const tgToken = telegramBotToken(env);
  const tgChat = String(
    env.AVA_TELEGRAM_OPERATOR_IDS || process.env.AVA_TELEGRAM_OPERATOR_IDS || "",
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];

  let wm = loadWatermarks();
  const seeded =
    Object.keys(wm.discord || {}).length === 0 &&
    Object.keys(wm.slack || {}).length === 0;
  if (seeded && !opts.forceFull) {
    await seedChannelDumpWatermarks({ env });
    pushStatusEvent("channel dump watermarks seeded (no history re-send)");
    return { ok: true, newCount: 0, skipped: true, seeded: true };
  }

  wm = loadWatermarks();
  wm.discord = wm.discord || {};
  wm.slack = wm.slack || {};

  const runId = stampFolder();
  const outDir = path.join(reportsRoot(), "incremental", runId);
  fs.mkdirSync(path.join(outDir, "discord"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "slack"), { recursive: true });

  const discordFiles = [];
  const slackFiles = [];
  let newCount = 0;

  const allCh = await discordFetch(
    headers,
    `/guilds/${ROOTMC_GUILD_ID}/channels`,
  );
  const textChannels = (Array.isArray(allCh) ? allCh : []).filter(
    (c) => c.type === 0,
  );

  for (const ch of textChannels) {
    const after = wm.discord[ch.id]?.afterId;
    const collected = [];
    try {
      if (after) {
        let before = null;
        let guard = 0;
        while (guard++ < 8) {
          let q = `?limit=100&after=${after}`;
          if (before) q += `&before=${before}`;
          const batch = await discordFetch(
            headers,
            `/channels/${ch.id}/messages${q}`,
          );
          if (!Array.isArray(batch) || !batch.length) break;
          collected.push(...batch);
          // oldest in this newest-first page
          before = batch[batch.length - 1].id;
          if (batch.length < 100) break;
          await new Promise((r) => setTimeout(r, 200));
        }
      } else {
        const batch = await discordFetch(
          headers,
          `/channels/${ch.id}/messages?limit=50`,
        );
        if (Array.isArray(batch)) collected.push(...batch);
      }
    } catch (err) {
      console.warn("channel dump discord", ch.name, err.message);
      continue;
    }

    if (!collected.length) {
      continue;
    }

    // oldest → newest
    collected.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    const newest = collected[collected.length - 1].id;
    wm.discord[ch.id] = { afterId: newest, name: ch.name };
    newCount += collected.length;

    const lines = [
      `# Discord #${ch.name} — incremental`,
      `id: ${ch.id}`,
      `dumped_at: ${new Date().toISOString()}`,
      `new_messages: ${collected.length}`,
      `after: ${after || "(none)"}`,
      "",
      "=".repeat(72),
      "",
      ...collected.map(formatDiscordMsg),
      "=".repeat(72),
    ];
    const file = path.join(
      outDir,
      "discord",
      `${safeName(ch.name)}_${ch.id}.txt`,
    );
    fs.writeFileSync(file, lines.join("\n"), "utf8");
    discordFiles.push(file);
    await new Promise((r) => setTimeout(r, 100));
  }

  if (slackTok) {
    for (const [id, name] of SLACK_CHANNELS) {
      const oldest = wm.slack[id]?.oldest;
      try {
        await slackApi(slackTok, "conversations.join", { channel: id });
        // inclusive oldest — skip the watermark message itself
        const data = await slackApi(slackTok, "conversations.history", {
          channel: id,
          limit: 200,
          oldest: oldest ? String(Number(oldest) + 0.000001) : undefined,
        });
        if (!data.ok) {
          console.warn("channel dump slack", name, data.error);
          continue;
        }
        const msgs = data.messages || [];
        if (!msgs.length) continue;

        // newest first → reverse
        const ordered = [...msgs].reverse();
        const newestTs = msgs.reduce(
          (a, m) => (Number(m.ts) > Number(a) ? m.ts : a),
          msgs[0].ts,
        );
        wm.slack[id] = { oldest: newestTs, name };
        newCount += ordered.length;

        const lines = [
          `# Slack #${name} — incremental`,
          `id: ${id}`,
          `dumped_at: ${new Date().toISOString()}`,
          `new_messages: ${ordered.length}`,
          `since: ${oldest || "(none)"}`,
          "",
          "=".repeat(72),
          "",
          ...ordered.map(formatSlackMsg),
          "=".repeat(72),
        ];
        const file = path.join(
          outDir,
          "slack",
          `${safeName(name)}_${id}.txt`,
        );
        fs.writeFileSync(file, lines.join("\n"), "utf8");
        slackFiles.push(file);
      } catch (err) {
        console.warn("channel dump slack", name, err.message);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  saveWatermarks(wm);

  if (newCount === 0) {
    appendAction("channelDump.tick", { newCount: 0, skipped: true });
    return { ok: true, newCount: 0, skipped: true, dir: outDir };
  }

  const indexPath = path.join(outDir, "00-INDEX.txt");
  const index = [
    `Ava incremental channel dump — ${new Date().toISOString()}`,
    `new_messages: ${newCount}`,
    `folder: ${outDir}`,
    "",
    `discord files: ${discordFiles.length}`,
    ...discordFiles.map((f) => `- ${path.basename(f)}`),
    "",
    `slack files: ${slackFiles.length}`,
    ...slackFiles.map((f) => `- ${path.basename(f)}`),
    "",
  ].join("\n");
  fs.writeFileSync(indexPath, index, "utf8");

  const masterPath = path.join(outDir, "00-MASTER-NEW.txt");
  const master = [
    index,
    "",
    "# ===== NEW MESSAGES =====",
    "",
    ...[...discordFiles, ...slackFiles].map((f) => {
      return (
        "\n" +
        "#".repeat(72) +
        "\n" +
        fs.readFileSync(f, "utf8")
      );
    }),
  ].join("\n");
  fs.writeFileSync(masterPath, master, "utf8");

  const discordBundle = path.join(outDir, "01-DISCORD-NEW.txt");
  const slackBundle = path.join(outDir, "02-SLACK-NEW.txt");
  fs.writeFileSync(
    discordBundle,
    discordFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n\n"),
    "utf8",
  );
  fs.writeFileSync(
    slackBundle,
    slackFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n\n"),
    "utf8",
  );

  if (tgToken && tgChat) {
    const sendFiles =
      String(
        process.env.AVA_CHANNEL_DUMP_TELEGRAM ||
          env.AVA_CHANNEL_DUMP_TELEGRAM ||
          "",
      ).trim() === "1";
    const sendSummary =
      sendFiles ||
      String(
        process.env.AVA_CHANNEL_DUMP_TELEGRAM_SUMMARY ||
          env.AVA_CHANNEL_DUMP_TELEGRAM_SUMMARY ||
          "",
      ).trim() === "1";
    try {
      if (sendSummary && !sendFiles) {
        await telegramSendMessage(
          tgToken,
          tgChat,
          `Ava filed channel dump on E (not attaching)\n${newCount} new · ${runId}\n${outDir}`,
        );
      }
      if (sendFiles) {
        await telegramSendMessage(
          tgToken,
          tgChat,
          `Ava incremental dump — ${newCount} new messages\n${runId}`,
        );
        await telegramSendDocument(
          tgToken,
          tgChat,
          indexPath,
          `INDEX — ${newCount} new msgs`,
        );
        await new Promise((r) => setTimeout(r, 400));
        await telegramSendDocument(
          tgToken,
          tgChat,
          masterPath,
          `MASTER new (${Math.round(fs.statSync(masterPath).size / 1024)} KB)`,
        );
        if (discordFiles.length) {
          await new Promise((r) => setTimeout(r, 400));
          await telegramSendDocument(
            tgToken,
            tgChat,
            discordBundle,
            "Discord — new only",
          );
        }
        if (slackFiles.length) {
          await new Promise((r) => setTimeout(r, 400));
          await telegramSendDocument(
            tgToken,
            tgChat,
            slackBundle,
            "Slack — new only",
          );
        }
      }
    } catch (err) {
      console.warn("channel dump telegram:", err.message);
    }
  }

  appendAction("channelDump.tick", {
    newCount,
    dir: outDir,
    discordFiles: discordFiles.length,
    slackFiles: slackFiles.length,
    telegramFiles:
      String(process.env.AVA_CHANNEL_DUMP_TELEGRAM || "").trim() === "1",
  });
  pushStatusEvent(
    `channel dump · ${newCount} new → ${outDir.replace(/\\/g, "/")}`,
  );
  return { ok: true, newCount, dir: outDir, skipped: false };
}
