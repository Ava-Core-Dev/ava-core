/**
 * When Ava joins a Slack channel, archive everything already there locally
 * under data/slack/channels/{id}/ for dig context + training.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths, pushStatusEvent } from "./store.mjs";
import { harvestSlackReactionsFromMessages } from "./reactionStore.mjs";
import { slackBotUserId } from "./config.mjs";

const DEFAULT_PAGE = 200;
/** Soft cap so a runaway channel can't fill the disk in one go (0 = unlimited). */
const MAX_MESSAGES = Math.max(
  0,
  Number(process.env.AVA_SLACK_ARCHIVE_MAX_MESSAGES || 50_000) || 50_000,
);

function slackRoot() {
  const dir = path.join(storePaths().dir, "slack");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "channels"), { recursive: true });
  return dir;
}

function registryPath() {
  return path.join(slackRoot(), "archives.json");
}

function channelDir(channelId) {
  const dir = path.join(slackRoot(), "channels", String(channelId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(registryPath(), "utf8"));
  } catch {
    return { channels: {}, updatedAt: 0 };
  }
}

function saveRegistry(reg) {
  reg.updatedAt = Date.now();
  fs.writeFileSync(registryPath(), JSON.stringify(reg, null, 2), "utf8");
}

export function isSlackChannelArchived(channelId) {
  const reg = loadRegistry();
  return Boolean(reg.channels?.[String(channelId)]?.complete);
}

function scrubSecrets(text) {
  return String(text || "")
    .replace(/xox[baprs]-[A-Za-z0-9-]+/g, "[redacted-token]")
    .replace(/xapp-[A-Za-z0-9-]+/g, "[redacted-token]")
    .replace(
      /(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    );
}

function normalizeMessage(m) {
  if (!m || typeof m !== "object") return null;
  return {
    ts: m.ts || null,
    thread_ts: m.thread_ts || null,
    user: m.user || null,
    bot_id: m.bot_id || null,
    subtype: m.subtype || null,
    text: scrubSecrets(m.text || ""),
    reply_count: m.reply_count || 0,
    reactions: (m.reactions || []).map((r) => ({
      name: r.name,
      count: r.count,
    })),
    files: (m.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      title: f.title,
      mimetype: f.mimetype,
      size: f.size,
      filetype: f.filetype,
    })),
    attachments: (m.attachments || []).map((a) => ({
      fallback: scrubSecrets(a.fallback || a.text || "").slice(0, 500),
      title: a.title || null,
    })),
    edited: m.edited || null,
  };
}

/** Bolt WebClient or raw bot token → conversations.* caller */
function apiClient(clientOrToken) {
  if (
    clientOrToken &&
    typeof clientOrToken.conversations?.history === "function"
  ) {
    return clientOrToken;
  }
  const token = String(clientOrToken || "").trim();
  if (!token) throw new Error("slack_archive_no_token");
  async function call(method, args = {}) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(args || {})) {
      if (v === undefined || v === null || v === "") continue;
      form.set(k, typeof v === "boolean" ? (v ? "true" : "false") : String(v));
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
  return {
    conversations: {
      info: (a) => call("conversations.info", a),
      history: (a) => call("conversations.history", a),
      replies: (a) => call("conversations.replies", a),
      list: (a) => call("conversations.list", a),
    },
  };
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchAllHistory(client, channelId) {
  const messages = [];
  let cursor;
  do {
    const data = await client.conversations.history({
      channel: channelId,
      limit: DEFAULT_PAGE,
      ...(cursor ? { cursor } : {}),
    });
    if (!data.ok) throw new Error(data.error || "conversations.history");
    messages.push(...(data.messages || []));
    cursor = data.response_metadata?.next_cursor || "";
    if (MAX_MESSAGES && messages.length >= MAX_MESSAGES) break;
    if (cursor) await sleep(350);
  } while (cursor);
  messages.reverse();
  if (MAX_MESSAGES && messages.length > MAX_MESSAGES) {
    return messages.slice(-MAX_MESSAGES);
  }
  return messages;
}

async function fetchFullThread(client, channelId, threadTs) {
  const all = [];
  let cursor;
  do {
    const data = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: DEFAULT_PAGE,
      cursor: cursor || undefined,
    });
    if (!data.ok) {
      if (data.error === "thread_not_found") return all;
      throw new Error(data.error || "conversations.replies");
    }
    for (const m of data.messages || []) {
      if (!all.some((x) => x.ts === m.ts)) all.push(m);
    }
    cursor = data.response_metadata?.next_cursor || "";
    if (cursor) await sleep(350);
  } while (cursor);
  return all;
}

/**
 * Full channel snapshot: meta + history.jsonl + threads/*.jsonl + registry mark.
 */
export async function archiveSlackChannel(clientOrToken, channelId, opts = {}) {
  const id = String(channelId || "").trim();
  if (!id) throw new Error("no_channel");
  const force = Boolean(opts.force);
  if (!force && isSlackChannelArchived(id)) {
    return { channelId: id, skipped: true, messages: 0, threads: 0 };
  }

  const client = apiClient(clientOrToken);
  const dir = channelDir(id);
  const info = await client.conversations.info({ channel: id });
  if (!info.ok) throw new Error(info.error || "conversations.info");

  const ch = info.channel || {};
  const meta = {
    id,
    name: ch.name || null,
    is_private: Boolean(ch.is_private),
    is_archived: Boolean(ch.is_archived),
    topic: scrubSecrets(ch.topic?.value || ""),
    purpose: scrubSecrets(ch.purpose?.value || ""),
    created: ch.created || null,
    creator: ch.creator || null,
    num_members: ch.num_members || null,
    archivedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify(meta, null, 2),
    "utf8",
  );

  const history = await fetchAllHistory(client, id);
  const historyPath = path.join(dir, "history.jsonl");
  const historyLines = [];
  const threadParents = [];

  for (const m of history) {
    const n = normalizeMessage(m);
    if (!n) continue;
    historyLines.push(JSON.stringify(n));
    if ((m.reply_count || 0) > 0 && m.ts) threadParents.push(m.ts);
  }
  fs.writeFileSync(
    historyPath,
    historyLines.join("\n") + (historyLines.length ? "\n" : ""),
    "utf8",
  );

  const threadsDir = path.join(dir, "threads");
  fs.mkdirSync(threadsDir, { recursive: true });
  let threadCount = 0;
  for (const ts of threadParents) {
    try {
      const all = await fetchFullThread(client, id, ts);
      const lines = all
        .map(normalizeMessage)
        .filter(Boolean)
        .map((n) => JSON.stringify(n));
      const safeTs = String(ts).replace(/[^\d.]/g, "_");
      fs.writeFileSync(
        path.join(threadsDir, `${safeTs}.jsonl`),
        lines.join("\n") + (lines.length ? "\n" : ""),
        "utf8",
      );
      threadCount += 1;
      await sleep(200);
    } catch (err) {
      console.warn(`slack archive thread ${id}/${ts}:`, err.message);
    }
  }

  const summary = {
    channelId: id,
    name: meta.name,
    messages: historyLines.length,
    threads: threadCount,
    complete: true,
    archivedAt: meta.archivedAt,
    historyFile: "history.jsonl",
  };
  fs.writeFileSync(
    path.join(dir, "index.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  const reg = loadRegistry();
  reg.channels = reg.channels || {};
  reg.channels[id] = {
    name: meta.name,
    messages: summary.messages,
    threads: summary.threads,
    complete: true,
    archivedAt: meta.archivedAt,
  };
  saveRegistry(reg);

  // Pull reactions on Ava's posts into the shared reaction store
  try {
    const avaId = opts.avaBotUserId || slackBotUserId() || "U0BMBNYPYA2";
    const { touched } = harvestSlackReactionsFromMessages(id, history, avaId);
    if (touched) {
      summary.reactionsHarvested = touched;
      console.log("slack reactions harvested", meta.name || id, touched);
    }
  } catch (err) {
    console.warn("slack reaction harvest:", err.message);
  }

  pushStatusEvent(
    `slack archive · #${meta.name || id} · ${summary.messages} msg · ${threadCount} threads`,
  );
  console.log(
    "slack archive complete",
    meta.name || id,
    summary.messages,
    "msgs",
    threadCount,
    "threads",
  );

  return summary;
}

/** Re-scan local Slack archives for Ava reactions (no network). */
export function harvestReactionsFromLocalSlackArchives(avaBotUserId) {
  const avaId = avaBotUserId || slackBotUserId() || "U0BMBNYPYA2";
  const root = path.join(slackRoot(), "channels");
  let touched = 0;
  let channels = 0;
  if (!fs.existsSync(root)) return { touched: 0, channels: 0 };
  for (const id of fs.readdirSync(root)) {
    const histPath = path.join(root, id, "history.jsonl");
    if (!fs.existsSync(histPath)) continue;
    const lines = fs
      .readFileSync(histPath, "utf8")
      .split("\n")
      .filter(Boolean);
    const msgs = [];
    for (const line of lines) {
      try {
        msgs.push(JSON.parse(line));
      } catch {
        /* skip */
      }
    }
    const r = harvestSlackReactionsFromMessages(id, msgs, avaId);
    touched += r.touched || 0;
    channels += 1;
    // threads
    const tdir = path.join(root, id, "threads");
    if (fs.existsSync(tdir)) {
      for (const f of fs.readdirSync(tdir).filter((x) => x.endsWith(".jsonl"))) {
        const tmsgs = [];
        for (const line of fs
          .readFileSync(path.join(tdir, f), "utf8")
          .split("\n")
          .filter(Boolean)) {
          try {
            tmsgs.push(JSON.parse(line));
          } catch {
            /* skip */
          }
        }
        touched += harvestSlackReactionsFromMessages(id, tmsgs, avaId).touched || 0;
      }
    }
  }
  return { touched, channels };
}

/** Archive every channel Ava is already a member of. */
export async function archiveAllJoinedSlackChannels(clientOrToken, opts = {}) {
  const client = apiClient(clientOrToken);
  const results = [];
  let cursor = "";
  const channels = [];
  do {
    const data = await client.conversations.list({
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
      cursor: cursor || undefined,
    });
    if (!data.ok) throw new Error(data.error || "conversations.list");
    channels.push(...(data.channels || []).filter((c) => c.is_member));
    cursor = data.response_metadata?.next_cursor || "";
  } while (cursor);

  for (const ch of channels) {
    try {
      const r = await archiveSlackChannel(client, ch.id, opts);
      results.push(r);
    } catch (err) {
      console.warn("slack archive", ch.name || ch.id, err.message);
      results.push({ channelId: ch.id, name: ch.name, error: err.message });
    }
    await sleep(400);
  }
  return results;
}

/** Load archived history snippets for context (newest N lines). */
export function loadSlackChannelArchive(channelId, { limit = 80 } = {}) {
  const file = path.join(channelDir(channelId), "history.jsonl");
  if (!fs.existsSync(file)) return [];
  const lines = fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  return lines
    .slice(-Math.max(1, limit))
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
