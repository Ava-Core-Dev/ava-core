/**
 * Pull substantive Discord messages for daily AI summaries.
 * Reads guild text / announcement / forum channels except static ones
 * (rules, unverified, report dumps, archives, etc.).
 */

import { discordBotFetch, listGuildChannels, type GuildChannelRow } from "./discord-rootmc-api";
import { resolveDiscordChannel, type DiscordChannelName } from "./rootmc-discord-channels";
import { isExiledDiscordUser } from "./rootmc-exiled-discord";

export type DiscordOperationalHighlight = {
  channel: string;
  kind: "message" | "forum_post";
  author: string;
  content: string;
  thread_title?: string;
};

type OpsEnv = {
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_GUILD_ID?: string;
  DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID?: string;
  DISCORD_ROOTMC_OPERATIONS_FORUM_CHANNEL_ID?: string;
  DISCORD_ROOTMC_APPEALS_FORUM_CHANNEL_ID?: string;
  DISCORD_ROOTMC_RULES_CHANNEL_ID?: string;
  DISCORD_ROOTMC_UNVERIFIED_CHANNEL_ID?: string;
  DISCORD_ROOTMC_CONSTITUTION_CHANNEL_ID?: string;
  DISCORD_ROOTMC_BOT_SPAM_CHANNEL_ID?: string;
  DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID?: string;
  DISCORD_ROOTMC_ECONOMY_ANNOUNCE_CHANNEL_ID?: string;
  DISCORD_ROOTMC_AUTOMATED_REPORTS_CHANNEL_ID?: string;
  DISCORD_ROOTMC_AI_ARCHIVE_CHANNEL_ID?: string;
  DISCORD_ROOTMC_AI_RAW_ARCHIVE_CHANNEL_ID?: string;
  DISCORD_ROOTMC_HOURLY_SNAPSHOT_CHANNEL_ID?: string;
  DISCORD_ROOTMC_LOGS_CHANNEL_ID?: string;
  DISCORD_FEEDBACK_CHANNEL_ID?: string;
  [key: string]: unknown;
};

/** Static / dump / archive channels — never feed these into Grok ops highlights. */
const STATIC_CHANNEL_NAMES: DiscordChannelName[] = [
  "rules",
  "unverified",
  "constitution",
  "botSpam",
  "feedback",
  "ingameChat",
  "dailyReport",
  "economy",
  "automatedReports",
  "aiArchive",
  "aiRawArchive",
  "hourlySnapshots",
  "logs",
  "apiReferences",
  "discordIds",
  "cronsAutomation",
  "pluginSales",
  "tasks",
  "gen2",
  "townInfo",
  "nationInfo",
];

const STATIC_NAME_RE =
  /^(rules?|unverified|welcome|verify|verification|read-?me|constitution|bot-?spam|logs?|archive|api-?reference|discord-?ids?|crons?|plugin-?sales?|tasks?|ingame-?chat|in-?game-?chat)$/i;

const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;
const GUILD_FORUM = 15;

const MAX_TEXT_CHANNELS = 50;
const MAX_FORUMS = 8;
const PER_CHANNEL_HIGHLIGHTS = 4;
const PER_FORUM_HIGHLIGHTS = 4;
const FINAL_HIGHLIGHT_CAP = 28;
const FETCH_CONCURRENCY = 6;

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function snowflakeFromMs(ms: number): string {
  return String((BigInt(Math.floor(ms)) - 1420070400000n) << 22n);
}

function snowflakeToMs(id: string): number {
  try {
    return Number((BigInt(id) >> 22n) + 1420070400000n);
  } catch {
    return 0;
  }
}

function cleanContent(raw: string): string {
  return raw
    .replace(/<@!?\d+>/g, "@user")
    .replace(/<#\d+>/g, "#channel")
    .replace(/<a?:\w+:\d+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulContent(content: string): boolean {
  const text = cleanContent(content);
  if (text.length < 24) return false;
  if (/^(gm+|gn+|lol+|ok+|yes+|no+|thanks?|ty|np)\.?$/i.test(text)) return false;
  return true;
}

export function excludedDiscordChannelsForGrok(env: OpsEnv): Set<string> {
  const ids = new Set<string>();
  for (const name of STATIC_CHANNEL_NAMES) {
    const id = resolveDiscordChannel(env, name, { allowBlank: true });
    if (id) ids.add(id);
  }
  return ids;
}

function isStaticByName(name: string): boolean {
  const n = str(name).replace(/^#+/, "");
  return STATIC_NAME_RE.test(n);
}

type DiscordMessageRow = {
  id?: string;
  timestamp?: string;
  content?: string;
  author?: { id?: string; username?: string; bot?: boolean };
};

async function fetchTextChannelHighlights(
  token: string,
  channelId: string,
  channelLabel: string,
  startMs: number,
  endMs: number,
  maxItems: number,
): Promise<DiscordOperationalHighlight[]> {
  const after = snowflakeFromMs(startMs);
  let before: string | undefined;
  const out: DiscordOperationalHighlight[] = [];

  for (let page = 0; page < 3 && out.length < maxItems; page++) {
    const params = new URLSearchParams({ limit: "100", after });
    if (before) params.set("before", before);
    const res = await discordBotFetch(
      token,
      `/channels/${encodeURIComponent(channelId)}/messages?${params}`,
    );
    if (!res.ok) break;
    const msgs = (await res.json()) as DiscordMessageRow[];
    if (!msgs.length) break;

    for (const msg of msgs) {
      const ts = Date.parse(msg.timestamp || "");
      if (Number.isNaN(ts) || ts < startMs || ts > endMs) continue;
      if (msg.author?.bot) continue;
      if (isExiledDiscordUser(msg.author?.id)) continue;
      const content = cleanContent(str(msg.content));
      if (!isUsefulContent(content)) continue;
      out.push({
        channel: channelLabel,
        kind: "message",
        author: str(msg.author?.username) || "member",
        content: content.slice(0, 500),
      });
      if (out.length >= maxItems) break;
    }

    if (msgs.length < 100) break;
    before = msgs[msgs.length - 1]?.id;
    if (!before) break;
  }

  return out;
}

async function listForumThreadsInWindow(
  token: string,
  forumId: string,
  startMs: number,
  endMs: number,
): Promise<Array<{ id: string; name: string }>> {
  const threads: Array<{ id: string; name: string }> = [];
  const paths = [
    `/channels/${encodeURIComponent(forumId)}/threads/active`,
    `/channels/${encodeURIComponent(forumId)}/threads/archived/public?limit=50`,
  ];

  for (const path of paths) {
    const res = await discordBotFetch(token, path);
    if (!res.ok) continue;
    const data = (await res.json()) as { threads?: Array<{ id?: string; name?: string }> };
    for (const row of data.threads || []) {
      const id = str(row.id);
      if (!id) continue;
      const createdMs = snowflakeToMs(id);
      if (createdMs < startMs || createdMs > endMs) continue;
      threads.push({ id, name: str(row.name) || "forum post" });
    }
  }

  return threads;
}

async function fetchForumPostBody(
  token: string,
  threadId: string,
): Promise<{ author: string; content: string } | null> {
  const res = await discordBotFetch(
    token,
    `/channels/${encodeURIComponent(threadId)}/messages?limit=5`,
  );
  if (!res.ok) return null;
  const msgs = (await res.json()) as DiscordMessageRow[];
  const starter = msgs[msgs.length - 1] || msgs[0];
  if (!starter || starter.author?.bot) return null;
  if (isExiledDiscordUser(starter.author?.id)) return null;
  const content = cleanContent(str(starter.content));
  if (!isUsefulContent(content)) return null;
  return {
    author: str(starter.author?.username) || "member",
    content: content.slice(0, 700),
  };
}

async function fetchForumHighlights(
  token: string,
  forumId: string,
  channelLabel: string,
  startMs: number,
  endMs: number,
  maxItems: number,
): Promise<DiscordOperationalHighlight[]> {
  const threads = await listForumThreadsInWindow(token, forumId, startMs, endMs);
  const out: DiscordOperationalHighlight[] = [];

  for (const thread of threads.slice(0, maxItems * 2)) {
    const body = await fetchForumPostBody(token, thread.id);
    if (!body) continue;
    out.push({
      channel: channelLabel,
      kind: "forum_post",
      author: body.author,
      content: body.content,
      thread_title: thread.name.slice(0, 120),
    });
    if (out.length >= maxItems) break;
  }

  return out;
}

export function resolveOperationsForumChannelId(env: OpsEnv): string {
  return (
    resolveDiscordChannel(env, "operationsForum", { allowBlank: true }) ||
    resolveDiscordChannel(env, "appealsForum", { allowBlank: true })
  );
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

function scoreHighlight(h: DiscordOperationalHighlight): number {
  return (h.kind === "forum_post" ? 2 : 1) + Math.min(h.content.length / 200, 3);
}

/** Guild-wide Discord highlights for the HST day (excludes static channels). */
export async function gatherDiscordOperationalHighlights(
  env: OpsEnv,
  startMs: number,
  endMs: number,
): Promise<DiscordOperationalHighlight[]> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const guildId = str(env.DISCORD_ROOTMC_GUILD_ID);
  if (!token || !guildId) return [];

  const excluded = excludedDiscordChannelsForGrok(env);
  const channels = await listGuildChannels(token, guildId);
  const readable = channels.filter((ch) => {
    const id = str(ch.id);
    if (!id || excluded.has(id)) return false;
    if (isStaticByName(ch.name)) return false;
    return ch.type === GUILD_TEXT || ch.type === GUILD_ANNOUNCEMENT || ch.type === GUILD_FORUM;
  });

  // Prefer general / updates / ops near the front, then the rest by position.
  const prefer = new Set(
    [
      resolveDiscordChannel(env, "general", { allowBlank: true }),
      resolveDiscordChannel(env, "updates", { allowBlank: true }),
      resolveOperationsForumChannelId(env),
      resolveDiscordChannel(env, "admins", { allowBlank: true }),
      resolveDiscordChannel(env, "governance", { allowBlank: true }),
      resolveDiscordChannel(env, "voting", { allowBlank: true }),
      resolveDiscordChannel(env, "proposals", { allowBlank: true }),
    ].filter(Boolean),
  );
  readable.sort((a, b) => {
    const ap = prefer.has(a.id) ? 0 : 1;
    const bp = prefer.has(b.id) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return (Number(a.position) || 0) - (Number(b.position) || 0);
  });

  const textChannels = readable
    .filter((c) => c.type === GUILD_TEXT || c.type === GUILD_ANNOUNCEMENT)
    .slice(0, MAX_TEXT_CHANNELS);
  const forums = readable.filter((c) => c.type === GUILD_FORUM).slice(0, MAX_FORUMS);

  const textBatches = await mapPool(textChannels, FETCH_CONCURRENCY, (ch: GuildChannelRow) =>
    fetchTextChannelHighlights(
      token,
      ch.id,
      str(ch.name) || ch.id.slice(-6),
      startMs,
      endMs,
      PER_CHANNEL_HIGHLIGHTS,
    ),
  );
  const forumBatches = await mapPool(forums, Math.min(FETCH_CONCURRENCY, 3), (ch: GuildChannelRow) =>
    fetchForumHighlights(
      token,
      ch.id,
      str(ch.name) || "forum",
      startMs,
      endMs,
      PER_FORUM_HIGHLIGHTS,
    ),
  );

  const merged = [...forumBatches.flat(), ...textBatches.flat()];
  merged.sort((a, b) => scoreHighlight(b) - scoreHighlight(a));
  return merged.slice(0, FINAL_HIGHLIGHT_CAP);
}
