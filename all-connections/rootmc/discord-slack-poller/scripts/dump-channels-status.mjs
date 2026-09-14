/**
 * Deep channel dump for Ava status pack.
 * Writes raw JSON under Desktop/channels status/_raw
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OUT = "C:\\Users\\rootr\\OneDrive\\Desktop\\channels status\\_raw";
const AVA_ID = "1532751879875072070";
const LEGACY_ID = "1511794429986345020";
const GUILD = "1516108585740800042";
const ALEX_TG = "6644482344";
const ALEX_DISCORD = "1497037418979786823";

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, "discord"), { recursive: true });
fs.mkdirSync(path.join(OUT, "telegram"), { recursive: true });
fs.mkdirSync(path.join(OUT, "slack"), { recursive: true });

function parseEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

const env = {
  ...parseEnv("E:\\.1 Work Stations\\RootMC\\.env"),
  ...parseEnv(process.env.ROOTMC_ENV_FILE || ""),
};
for (const [k, v] of Object.entries(env)) {
  if (v && !process.env[k]) process.env[k] = v;
}

const discordToken = (
  env.AVA_DISCORD_BOT_TOKEN ||
  env.DISCORD_ROOTMC_BOT_TOKEN ||
  ""
).replace(/^Bot\s+/i, "");
const slackToken = (env.AVA_SLACK_BOT_TOKEN || "").replace(/^Bearer\s+/i, "");
const tgToken = env.AVA_TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || "";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function discord(pathname, opts = {}) {
  const res = await fetch(`https://discord.com/api/v10${pathname}`, {
    ...opts,
    headers: {
      Authorization: `Bot ${discordToken}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (res.status === 429) {
    const wait = (data.retry_after || 1) * 1000 + 200;
    await sleep(wait);
    return discord(pathname, opts);
  }
  return { ok: res.ok, status: res.status, data };
}

async function slack(method, body = null) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${slackToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return data;
}

async function telegram(method, body = null) {
  const res = await fetch(`https://api.telegram.org/bot${tgToken}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function summarizeMsgs(msgs, surface) {
  const ava = [];
  const unanswered = [];
  const recent = msgs.slice(0, 15).map(compactMsg);
  for (const m of msgs) {
    const authorId =
      surface === "discord"
        ? String(m.author?.id || "")
        : surface === "slack"
          ? String(m.user || m.bot_id || "")
          : String(m.from?.id || m.authorId || "");
    const isAva =
      surface === "discord"
        ? authorId === AVA_ID || authorId === LEGACY_ID || m.author?.bot
        : surface === "telegram"
          ? Boolean(m.from?.is_bot) || authorId === String(env.AVA_TELEGRAM_BOT_ID || "")
          : /ava|bot/i.test(String(m.username || m.bot_id || ""));
    const content =
      surface === "discord"
        ? m.content || ""
        : surface === "slack"
          ? m.text || ""
          : m.text || m.caption || "";
    if (
      surface === "discord" &&
      (authorId === AVA_ID || authorId === LEGACY_ID)
    ) {
      ava.push(compactMsg(m, surface));
    }
    if (
      surface === "discord" &&
      content.includes(`<@${AVA_ID}>`) &&
      authorId !== AVA_ID
    ) {
      // check if Ava replied after
      unanswered.push(compactMsg(m, surface));
    }
  }
  return {
    total: msgs.length,
    avaPosts: ava.length,
    recent,
    sampleAva: ava.slice(0, 20),
    mentionHits: unanswered.length,
    oldest: msgs.length ? msgs[msgs.length - 1] : null,
    newest: msgs.length ? msgs[0] : null,
  };
}

function compactMsg(m, surface = "discord") {
  if (surface === "slack") {
    return {
      ts: m.ts,
      user: m.user || m.bot_id,
      text: String(m.text || "").slice(0, 500),
    };
  }
  if (surface === "telegram") {
    return {
      id: m.message_id || m.id,
      from: m.from?.username || m.from?.id || m.who,
      date: m.date || m.at,
      text: String(m.text || m.caption || m.content || "").slice(0, 500),
    };
  }
  return {
    id: m.id,
    at: m.timestamp,
    author: m.author?.username || m.author?.global_name || m.author?.id,
    authorId: m.author?.id,
    bot: Boolean(m.author?.bot),
    content: String(m.content || "").slice(0, 800),
    ref: m.message_reference?.message_id || null,
  };
}

async function dumpDiscordChannel(ch, maxPages = 25) {
  // ~100 msgs/page → up to 2500
  let before = null;
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const q = before
      ? `/channels/${ch.id}/messages?limit=100&before=${before}`
      : `/channels/${ch.id}/messages?limit=100`;
    const r = await discord(q);
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        error: r.data,
        messages: all,
        summary: summarizeMsgs(all, "discord"),
      };
    }
    const batch = Array.isArray(r.data) ? r.data : [];
    if (!batch.length) break;
    all.push(...batch);
    before = batch[batch.length - 1].id;
    if (batch.length < 100) break;
    await sleep(350);
  }
  return {
    ok: true,
    messages: all,
    summary: summarizeMsgs(all, "discord"),
  };
}

async function dumpDiscord() {
  console.log("discord: listing guild channels…");
  const listed = await discord(`/guilds/${GUILD}/channels`);
  if (!listed.ok) {
    fs.writeFileSync(
      path.join(OUT, "discord", "_list-error.json"),
      JSON.stringify(listed, null, 2),
    );
    throw new Error(`discord list failed ${listed.status}`);
  }
  const channels = (Array.isArray(listed.data) ? listed.data : []).sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || "")),
  );
  fs.writeFileSync(
    path.join(OUT, "discord", "_channels.json"),
    JSON.stringify(channels, null, 2),
  );

  // Also try Alex DM channel
  const dmCreate = await discord(`/users/@me/channels`, {
    method: "POST",
    body: JSON.stringify({ recipient_id: ALEX_DISCORD }),
  });
  if (dmCreate.ok && dmCreate.data?.id) {
    channels.push({
      id: dmCreate.data.id,
      name: "dm-alex",
      type: 1,
      _label: "DM Alex",
    });
  }

  const inventory = [];
  for (const ch of channels) {
    // 0 text, 5 announce, 11 public thread parent skip empty, 15 forum — try read anyway for text-like
    const readable = [0, 1, 5, 10, 11, 12].includes(ch.type);
    const row = {
      id: ch.id,
      name: ch.name || ch._label || ch.id,
      type: ch.type,
      parent_id: ch.parent_id || null,
      topic: ch.topic || null,
      readable,
    };
    if (!readable) {
      inventory.push({ ...row, skipped: true, reason: "non-text-type" });
      continue;
    }
    console.log(`discord: #${row.name} (${ch.id}) type=${ch.type}`);
    const dump = await dumpDiscordChannel(ch, ch.type === 1 ? 15 : 20);
    const file = path.join(
      OUT,
      "discord",
      `${String(row.name).replace(/[^\w.-]+/g, "_")}__${ch.id}.json`,
    );
    // store compact messages to keep files manageable
    const compact = {
      channel: row,
      ok: dump.ok,
      status: dump.status,
      error: dump.error || null,
      fetched: dump.messages.length,
      summary: dump.summary,
      messages: dump.messages.map((m) => compactMsg(m, "discord")),
    };
    fs.writeFileSync(file, JSON.stringify(compact, null, 2));
    inventory.push({
      ...row,
      file: path.basename(file),
      fetched: dump.messages.length,
      ok: dump.ok,
      status: dump.status,
      avaPosts: dump.summary.avaPosts,
      mentionHits: dump.summary.mentionHits,
      newestAt: dump.summary.newest?.timestamp || null,
      oldestAt: dump.summary.oldest?.timestamp || null,
    });
    await sleep(400);
  }
  fs.writeFileSync(
    path.join(OUT, "discord", "_inventory.json"),
    JSON.stringify(inventory, null, 2),
  );
  return inventory;
}

async function dumpTelegram() {
  console.log("telegram: me + alex chat…");
  const me = await telegram("getMe");
  fs.writeFileSync(path.join(OUT, "telegram", "_me.json"), JSON.stringify(me, null, 2));

  const chat = await telegram("getChat", { chat_id: ALEX_TG });
  fs.writeFileSync(
    path.join(OUT, "telegram", "chat-alex.json"),
    JSON.stringify(chat, null, 2),
  );

  // Bot API cannot paginate full history; pull getUpdates + local buffers
  const updates = await telegram("getUpdates", { limit: 100, timeout: 0 });
  fs.writeFileSync(
    path.join(OUT, "telegram", "getUpdates.json"),
    JSON.stringify(updates, null, 2),
  );

  // Local Ava telegram context / vaults
  const localFiles = [
    "E:\\.Ava_Ivy\\data\\telegram",
    "E:\\.Ava_Ivy\\data\\conversations",
    "E:\\.1 Work Stations\\RootMC\\Web Files\\rootmc-ava-desktop\\data",
  ];
  const localCopy = {};
  for (const dir of localFiles) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && st.size < 8_000_000) {
          const dest = path.join(OUT, "telegram", `local__${f}`);
          fs.copyFileSync(p, dest);
          localCopy[f] = dest;
        } else if (st.isDirectory()) {
          // copy json children
          for (const c of fs.readdirSync(p).slice(0, 50)) {
            const cp = path.join(p, c);
            if (fs.statSync(cp).isFile() && c.endsWith(".json")) {
              const dest = path.join(OUT, "telegram", `local__${f}__${c}`);
              fs.copyFileSync(cp, dest);
              localCopy[`${f}/${c}`] = dest;
            }
          }
        }
      } catch {
        /* skip */
      }
    }
  }

  // Try getChatHistory isn't available; sendChatAction no. Use getUpdates messages filtered to Alex
  const tgMsgs = [];
  for (const u of updates.result || []) {
    const m = u.message || u.edited_message || u.channel_post;
    if (!m) continue;
    if (String(m.chat?.id) === ALEX_TG || String(m.from?.id) === ALEX_TG) {
      tgMsgs.push(m);
    }
  }

  // Also scrape boot-sequence / last-reply / training for telegram
  const handoffSnips = {};
  for (const name of [
    "last-reply.json",
    "urgent-telegram.json",
    "telegram-presence.json",
    "boot-sequence.log",
    "status-events.jsonl",
  ]) {
    const p = path.join("E:\\.Ava_Ivy\\data", name);
    if (fs.existsSync(p)) {
      const dest = path.join(OUT, "telegram", `handoff__${name}`);
      fs.copyFileSync(p, dest);
      handoffSnips[name] = dest;
    }
  }

  const pack = {
    me,
    chat,
    liveUpdateMsgs: tgMsgs.map((m) => compactMsg(m, "telegram")),
    localCopy: Object.keys(localCopy),
    handoffSnips: Object.keys(handoffSnips),
    note: "Telegram Bot API cannot read full DM history; live getUpdates + local Ava buffers only.",
  };
  fs.writeFileSync(
    path.join(OUT, "telegram", "_summary.json"),
    JSON.stringify(pack, null, 2),
  );
  return pack;
}

async function dumpSlack() {
  console.log("slack: auth + channels…");
  const auth = await slack("auth.test");
  fs.writeFileSync(path.join(OUT, "slack", "_auth.json"), JSON.stringify(auth, null, 2));
  if (!auth.ok) return { ok: false, auth };

  const channels = [];
  let cursor;
  do {
    const list = await slack("conversations.list", {
      types: "public_channel,private_channel,im,mpim",
      limit: 200,
      cursor,
      exclude_archived: true,
    });
    if (!list.ok) {
      fs.writeFileSync(
        path.join(OUT, "slack", "_list-error.json"),
        JSON.stringify(list, null, 2),
      );
      break;
    }
    channels.push(...(list.channels || []));
    cursor = list.response_metadata?.next_cursor || "";
  } while (cursor);

  fs.writeFileSync(
    path.join(OUT, "slack", "_channels.json"),
    JSON.stringify(channels, null, 2),
  );

  const inventory = [];
  for (const ch of channels) {
    const name = ch.name || ch.user || ch.id;
    console.log(`slack: ${name} (${ch.id})`);
    const msgs = [];
    let cursor2;
    for (let page = 0; page < 15; page++) {
      const hist = await slack("conversations.history", {
        channel: ch.id,
        limit: 200,
        cursor: cursor2 || undefined,
      });
      if (!hist.ok) {
        inventory.push({
          id: ch.id,
          name,
          ok: false,
          error: hist.error,
          is_im: ch.is_im,
          is_channel: ch.is_channel,
        });
        break;
      }
      msgs.push(...(hist.messages || []));
      cursor2 = hist.response_metadata?.next_cursor || "";
      if (!cursor2) break;
      await sleep(300);
    }
    const file = path.join(
      OUT,
      "slack",
      `${String(name).replace(/[^\w.-]+/g, "_")}__${ch.id}.json`,
    );
    const pack = {
      channel: {
        id: ch.id,
        name,
        is_im: ch.is_im,
        is_private: ch.is_private,
        is_channel: ch.is_channel,
        topic: ch.topic?.value || null,
        purpose: ch.purpose?.value || null,
      },
      fetched: msgs.length,
      messages: msgs.map((m) => compactMsg(m, "slack")),
    };
    fs.writeFileSync(file, JSON.stringify(pack, null, 2));
    inventory.push({
      id: ch.id,
      name,
      file: path.basename(file),
      fetched: msgs.length,
      ok: true,
      is_im: ch.is_im,
      newest: msgs[0]?.ts || null,
      oldest: msgs[msgs.length - 1]?.ts || null,
    });
    await sleep(350);
  }
  fs.writeFileSync(
    path.join(OUT, "slack", "_inventory.json"),
    JSON.stringify(inventory, null, 2),
  );
  return inventory;
}

async function copyAvaRuntime() {
  const dest = path.join(OUT, "ava-runtime");
  fs.mkdirSync(dest, { recursive: true });
  const files = [
    "lockout.json",
    "hush.json",
    "mood.json",
    "sleep.json",
    "dig-health.json",
    "cloud-dark.json",
    "watermark.json",
    "last-reply.json",
    "heartbeat.json",
    "liveness.json",
    "brain-mode.json",
    "note-keeper related",
  ];
  // copy key json
  const dataDir = "E:\\.Ava_Ivy\\data";
  for (const f of fs.readdirSync(dataDir)) {
    if (!/\.(json|jsonl|log)$/i.test(f)) continue;
    if (f.startsWith("_tmp")) continue;
    const p = path.join(dataDir, f);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.size < 5_000_000) {
        fs.copyFileSync(p, path.join(dest, f));
      }
    } catch {
      /* skip */
    }
  }
  // notes
  const notes = "C:\\Users\\rootr\\OneDrive\\Desktop\\ava-notes";
  if (fs.existsSync(notes)) {
    const nd = path.join(dest, "ava-notes");
    fs.mkdirSync(nd, { recursive: true });
    for (const f of fs.readdirSync(notes)) {
      const p = path.join(notes, f);
      if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(nd, f));
    }
  }
}

const report = { startedAt: new Date().toISOString() };
try {
  await copyAvaRuntime();
  report.discord = await dumpDiscord();
  report.telegram = await dumpTelegram();
  report.slack = await dumpSlack();
} catch (err) {
  report.error = String(err?.stack || err);
  console.error(err);
}
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(OUT, "_run.json"), JSON.stringify(report, null, 2));
console.log("DONE", report.finishedAt);
