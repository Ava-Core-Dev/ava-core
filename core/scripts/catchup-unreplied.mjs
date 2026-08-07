/**
 * Find unreplied Ava mentions on Discord + Slack and reply kindly.
 */
import {
  loadEnv,
  botToken,
  slackBotToken,
  DISCORD_API,
  ROOTMC_GUILD_ID,
  AVA_CHANNELS,
  slackBotUserId,
  watchChannels,
} from "../src/config.mjs";
import { authHeaders } from "../src/discordApi.mjs";
import { recommend } from "../src/recommend.mjs";
import { buildPlayerContext } from "../src/playerContext.mjs";

const AVA = "1532751879875072070";
const ZUPPA = "788153722198294618";
const env = await loadEnv();
const discordHeaders = authHeaders(botToken(env));
const slackToken = slackBotToken(env);
const slackBot = slackBotUserId(env) || "U0BMBNYPYA2";

async function slackApi(method, body = {}) {
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

function mentionsAvaDiscord(m) {
  if (m.author?.id === AVA || m.author?.bot) return false;
  const c = String(m.content || "");
  return (
    m.mentions?.some((u) => u.id === AVA) ||
    c.includes(`<@${AVA}>`) ||
    c.includes(`<@!${AVA}>`) ||
    /(^|\W)@?ava(\s+ivy)?(\W|$)/i.test(c)
  );
}

function softAddress(m) {
  // "ava" / "Ava Ivy" without hard mention — still catch unreplied asks
  if (m.author?.id === AVA || m.author?.bot) return false;
  const c = String(m.content || "");
  if (c.includes(`<@${AVA}>`) || c.includes(`<@!${AVA}>`)) return true;
  return /\bava(\s+ivy)?\b/i.test(c) && /\?|please|can you|could you|help|look|ping|hey|yo\b/i.test(c);
}

async function discordRecent(channelId, limit = 50) {
  const res = await fetch(
    `${DISCORD_API}/channels/${channelId}/messages?limit=${limit}`,
    { headers: discordHeaders },
  );
  if (!res.ok) return [];
  const msgs = await res.json();
  return Array.isArray(msgs) ? msgs : [];
}

async function discordReply(channelId, messageId, content) {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: discordHeaders,
    body: JSON.stringify({
      content: String(content).slice(0, 1900),
      message_reference: { message_id: messageId },
      allowed_mentions: { parse: [], users: [] },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function scanDiscord() {
  const chRes = await fetch(`${DISCORD_API}/guilds/${ROOTMC_GUILD_ID}/channels`, {
    headers: discordHeaders,
  });
  const channels = await chRes.json();
  const textChannels = (channels || []).filter((c) => c.type === 0 || c.type === 5);
  const open = [];

  for (const c of textChannels) {
    const msgs = await discordRecent(c.id, 45);
    // newest first
    for (const m of msgs) {
      if (!mentionsAvaDiscord(m) && !softAddress(m)) continue;
      // skip Zuppa hard-pings content handling still OK to reply without tagging him
      const newer = msgs.filter((x) => BigInt(x.id) > BigInt(m.id));
      const avaAfter = newer.some((x) => x.author?.id === AVA);
      const refReply = newer.some(
        (x) => x.author?.id === AVA && x.message_reference?.message_id === m.id,
      );
      if (refReply || avaAfter) continue;
      open.push({
        surface: "discord",
        channelId: c.id,
        channel: c.name,
        id: m.id,
        author: m.author?.username,
        authorId: m.author?.id,
        content: String(m.content || "").slice(0, 400),
        messages: msgs,
      });
    }
  }
  return open;
}

/** Discord DMs — any human msg without an Ava reply after is open. */
async function scanDiscordDms() {
  const open = [];
  const listRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    headers: discordHeaders,
  });
  const list = await listRes.json();
  if (!Array.isArray(list)) {
    console.warn("dm list failed", JSON.stringify(list).slice(0, 200));
    return open;
  }
  for (const c of list) {
    // type 1 = DM, 3 = group DM
    if (c.type !== 1 && c.type !== 3) continue;
    const recip = (c.recipients || [])
      .map((r) => r.username || r.id)
      .join(",");
    const msgs = await discordRecent(c.id, 40);
    for (const m of msgs) {
      if (!m?.id || m.author?.bot || m.author?.id === AVA) continue;
      const newer = msgs.filter((x) => BigInt(x.id) > BigInt(m.id));
      const avaAfter = newer.some((x) => x.author?.id === AVA || x.author?.bot);
      const refReply = newer.some(
        (x) =>
          (x.author?.id === AVA || x.author?.bot) &&
          x.message_reference?.message_id === m.id,
      );
      if (refReply || avaAfter) continue;
      open.push({
        surface: "discord",
        channelId: c.id,
        channel: `dm:${recip || c.id}`,
        id: m.id,
        author: m.author?.username,
        authorId: m.author?.id,
        content: String(m.content || "").slice(0, 400),
        messages: msgs,
      });
    }
  }
  return open;
}

async function scanSlack() {
  if (!slackToken) return [];
  const open = [];
  let cursor = "";
  const channels = [];
  do {
    const data = await slackApi("conversations.list", {
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
      cursor: cursor || undefined,
    });
    if (!data.ok) break;
    channels.push(...(data.channels || []).filter((c) => c.is_member));
    cursor = data.response_metadata?.next_cursor || "";
  } while (cursor);

  for (const ch of channels) {
    const hist = await slackApi("conversations.history", {
      channel: ch.id,
      limit: 40,
    });
    if (!hist.ok) continue;
    const msgs = hist.messages || [];
    // Slack history is newest first
    for (const m of msgs) {
      if (m.subtype || m.bot_id) continue;
      if (m.user === slackBot) continue;
      const text = String(m.text || "");
      const pinged =
        text.includes(`<@${slackBot}>`) ||
        /(^|\W)@?ava(\s+ivy)?(\W|$)/i.test(text);
      if (!pinged) continue;
      // answered if any Ava bot message after this ts in channel (or thread reply from Ava)
      const newer = msgs.filter((x) => Number(x.ts) > Number(m.ts));
      const avaAfter = newer.some(
        (x) => x.user === slackBot || x.bot_id || (x.text || "").includes("— Ava"),
      );
      // also check thread
      let threadAva = false;
      if (m.reply_count > 0) {
        const th = await slackApi("conversations.replies", {
          channel: ch.id,
          ts: m.ts,
          limit: 20,
        });
        threadAva = (th.messages || []).some(
          (x) => x.ts !== m.ts && (x.user === slackBot || x.bot_id),
        );
      }
      if (avaAfter || threadAva) continue;
      open.push({
        surface: "slack",
        channelId: ch.id,
        channel: ch.name,
        id: m.ts,
        author: m.user,
        content: text.slice(0, 400),
      });
    }
  }
  return open;
}

async function kindReply(ask) {
  const q = ask.content
    .replace(new RegExp(`<@!?${AVA}>`, "g"), "")
    .replace(new RegExp(`<@${slackBot}>`, "g"), "")
    .trim() || "hey — catching up, what's up?";

  let answer;
  try {
    answer = await recommend({
      question: q,
      context:
        `Catch-up reply. Be kind, brief, warm. Surface=${ask.surface}. Channel=#${ask.channel}. ` +
        `They may have been waiting. Acknowledge delay lightly without over-apologizing. ` +
        `Never @ping Zuppa by Discord id. Player currency is Gold (G).`,
      env,
      authorId: ask.authorId || ask.author || "",
      authorName: ask.author || "",
      surface: ask.surface === "slack" ? "slack" : "discord",
    });
  } catch (err) {
    answer =
      "hey — catching up on this now. sorry I left you hanging. still here if you want to dig in.\n— Ava";
    console.warn("recommend failed:", err.message);
  }

  let text = String(answer || "").trim();
  // never allow Zuppa numeric mention; do not force "— Ava" (empty/signoff-only = skip)
  text = text.replace(new RegExp(`<@!?${ZUPPA}>`, "g"), "Zuppa");
  text = text.replace(/\n+[—\-–]\s*Ava\s*$/i, "").trim();
  if (!text || /^[—\-–]\s*Ava\s*$/i.test(text)) return null;
  return text.slice(0, 1900);
}

const discordOpen = await scanDiscord();
const dmOpen = await scanDiscordDms();
const slackOpen = await scanSlack();
// Dedupe by id
const seen = new Set();
const all = [...dmOpen, ...discordOpen, ...slackOpen].filter((a) => {
  const k = `${a.surface}:${a.channelId}:${a.id}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

console.log("open asks:", all.length, `(dms=${dmOpen.length} guild=${discordOpen.length} slack=${slackOpen.length})`);
for (const a of all) {
  console.log(`- [${a.surface}] #${a.channel} ${a.author}: ${a.content.slice(0, 100)}`);
}

const results = [];
for (const ask of all.slice(0, 40)) {
  try {
    const content = await kindReply(ask);
    if (!content) {
      console.log("skip empty/signoff", ask.surface, ask.channel);
      continue;
    }
    if (ask.surface === "discord") {
      const msg = await discordReply(ask.channelId, ask.id, content);
      results.push({ ok: true, surface: "discord", channel: ask.channel, id: msg.id });
      console.log("replied discord", ask.channel, msg.id);
    } else {
      const data = await slackApi("chat.postMessage", {
        channel: ask.channelId,
        thread_ts: ask.id,
        text: content,
      });
      if (!data.ok) throw new Error(data.error);
      results.push({ ok: true, surface: "slack", channel: ask.channel, id: data.ts });
      console.log("replied slack", ask.channel, data.ts);
    }
    await new Promise((r) => setTimeout(r, 800));
  } catch (err) {
    results.push({ ok: false, surface: ask.surface, channel: ask.channel, error: err.message });
    console.error("fail", ask.channel, err.message);
  }
}

console.log(JSON.stringify({ open: all.length, replied: results.filter((r) => r.ok).length, results }, null, 2));
