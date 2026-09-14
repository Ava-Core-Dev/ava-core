/**
 * RSS watch — poll configured feeds (rss-feeds.json) and post new items.
 * First run seeds watermarks without spamming the channel.
 */
import fs from "node:fs";
import path from "node:path";
import { AVA_HANDOFF, AVA_CHANNELS } from "./config.mjs";
import { pushStatusEvent } from "./store.mjs";

const FEEDS_FILE = () => path.join(AVA_HANDOFF, "data", "rss-feeds.json");
const STATE_FILE = () => path.join(AVA_HANDOFF, "data", "rss-state.json");
const POLL_MS = Math.max(
  60_000,
  Number(process.env.AVA_RSS_POLL_MS || 15 * 60_000) || 15 * 60_000,
);
const MAX_POST_PER_PASS = Math.min(
  5,
  Math.max(1, Number(process.env.AVA_RSS_MAX_POST || 2) || 2),
);

let lastPoll = 0;
let ticking = false;

function loadFeeds() {
  const p = FEEDS_FILE();
  if (!fs.existsSync(p)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return (Array.isArray(j.feeds) ? j.feeds : []).filter((f) => f?.enabled !== false && f?.url);
  } catch {
    return [];
  }
}

function loadState() {
  const p = STATE_FILE();
  if (!fs.existsSync(p)) return { feeds: {} };
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) || { feeds: {} };
  } catch {
    return { feeds: {} };
  }
}

function saveState(state) {
  const p = STATE_FILE();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
}

function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRssItems(xml) {
  const items = [];
  const blocks = String(xml || "").match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const title = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1];
    const link = (block.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i) || [])[1];
    const guid = (block.match(/<guid[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/guid>/i) || [])[1];
    const pubDate = (block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1];
    const desc = (block.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i) || [])[1];
    const id = String(guid || link || title || "").trim();
    if (!id || !title) continue;
    items.push({
      id,
      title: stripHtml(title).slice(0, 200),
      link: stripHtml(link).slice(0, 500),
      pubDate: String(pubDate || "").trim(),
      summary: stripHtml(desc).slice(0, 280),
    });
  }
  return items;
}

function channelFor(feed) {
  const key = String(feed.postChannel || "updates");
  return AVA_CHANNELS[key] || AVA_CHANNELS.updates || AVA_CHANNELS.changelog;
}

/**
 * @param {{ reply?: (channelId: string, content: string) => Promise<any> }} opts
 */
export async function pollRssFeeds(opts = {}) {
  if (ticking) return { skipped: true, reason: "busy" };
  const now = Date.now();
  if (now - lastPoll < POLL_MS && lastPoll > 0) {
    return { skipped: true, reason: "interval" };
  }
  ticking = true;
  lastPoll = now;
  const feeds = loadFeeds();
  if (!feeds.length) {
    ticking = false;
    return { ok: true, feeds: 0, posted: 0 };
  }
  const state = loadState();
  if (!state.feeds) state.feeds = {};
  let posted = 0;
  let seenNew = 0;

  try {
    for (const feed of feeds) {
      const fid = String(feed.id || feed.url);
      let xml = "";
      try {
        const res = await fetch(feed.url, {
          headers: { "User-Agent": "AvaIvy-RSS/1.0 (RootMC)" },
        });
        if (!res.ok) {
          console.warn(`rss ${fid}: HTTP ${res.status}`);
          continue;
        }
        xml = await res.text();
      } catch (err) {
        console.warn(`rss ${fid}:`, err.message);
        continue;
      }

      const items = parseRssItems(xml);
      const st = state.feeds[fid] || { seen: [], seeded: false };
      const seen = new Set(st.seen || []);

      if (!st.seeded) {
        // First pass: remember current items, don't flood Discord
        for (const it of items) seen.add(it.id);
        state.feeds[fid] = {
          seen: [...seen].slice(0, 200),
          seeded: true,
          title: feed.title || fid,
          lastPoll: new Date().toISOString(),
        };
        pushStatusEvent(`rss seeded · ${fid} · ${items.length} items`);
        continue;
      }

      const fresh = items.filter((it) => !seen.has(it.id));
      // RSS is usually newest-first; post oldest-of-batch first
      const toPost = fresh.slice(0, MAX_POST_PER_PASS).reverse();
      seenNew += fresh.length;

      for (const it of toPost) {
        seen.add(it.id);
        const ch = channelFor(feed);
        const line = [
          `**Minecraft update** · ${it.title}`,
          it.link || "",
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 1800);
        if (opts.reply && ch) {
          try {
            await opts.reply(ch, line);
            posted += 1;
          } catch (err) {
            console.warn(`rss post ${fid}:`, err.message);
          }
        }
      }

      // Mark all fresh as seen even if we capped posts (avoid backlog spam later)
      for (const it of fresh) seen.add(it.id);
      state.feeds[fid] = {
        seen: [...seen].slice(0, 200),
        seeded: true,
        title: feed.title || fid,
        lastPoll: new Date().toISOString(),
      };
    }
    saveState(state);
    if (posted || seenNew) {
      pushStatusEvent(`rss · +${seenNew} new · posted ${posted}`);
    }
    return { ok: true, feeds: feeds.length, posted, newItems: seenNew };
  } finally {
    ticking = false;
  }
}

export function rssPollIntervalMs() {
  return POLL_MS;
}
