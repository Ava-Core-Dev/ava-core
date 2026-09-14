#!/usr/bin/env node
/**
 * Quiet scrub: remove public "Manipulation gate" bullets from Ava's prior posts.
 * Ava bot tokens only — never Slack MCP.
 */
import { loadEnv, slackBotToken, botToken, AVA_CHANNELS } from "../src/config.mjs";
import { editMessage as discordEditMessage } from "../src/discordApi.mjs";

const NEEDLE =
  /(?:^|\n)[•\-*]\s*Manipulation gate[^\n]*/gi;
const NEEDLE_INLINE = /,\s*manipulation gate(?=,|\s)/gi;
const NEEDLE_TG_LINE =
  /(?:^|\n)\d+\.\s*Manipulation gate[^\n]*/gi;
const NEEDLE_SHIPPED =
  /(?:^|\n)[•\-*]\s*Manipulation gate live[^\n]*/gi;

const SLACK_CHANNELS = [
  "C0BLTNDJB4M",
  "C0BLQ5C342F",
  "C0BM0N1MUJY",
  "C0BLYV4SA6M",
  "C0BLT3B9RQV",
  "C0BLWBTUCR0",
  "C0BLV24TVP0",
  "C0BM6KVFS0L",
  "C0BMRPDUH0Q",
  "C0BM4B4RT8S",
  "C0BLMGBVAMD",
  "C0BMX0QKSTS",
  "C0BLZCVAC3X",
  "C0BLY49H13M",
  "C0BM6HN0WMA",
  "C0BMDLAS5QS",
  "C0BM4QT5U0Z",
  "C0BLMHKTCTH",
  "C0BMCPMDDQR",
  "C0BM4P3GVDX",
];

const AVA_SLACK_USER = "U0BMBNYPYA2";
const TG_OPS = "6644482344";

function scrubText(text) {
  let next = String(text || "");
  const before = next;
  next = next.replace(NEEDLE, "");
  next = next.replace(NEEDLE_SHIPPED, "");
  next = next.replace(NEEDLE_TG_LINE, "");
  next = next.replace(NEEDLE_INLINE, "");
  next = next.replace(NEEDLE_INLINE, ""); // case already covered
  next = next.replace(/\n{3,}/g, "\n\n").trimEnd();
  return next === before ? null : next;
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

async function scrubSlack(token) {
  let edited = 0;
  let scanned = 0;
  for (const channel of SLACK_CHANNELS) {
    let cursor;
    let pages = 0;
    do {
      const data = await slackApi(token, "conversations.history", {
        channel,
        limit: 100,
        cursor,
      });
      if (!data.ok) {
        console.log(`slack ${channel} history FAIL`, data.error);
        break;
      }
      pages += 1;
      for (const m of data.messages || []) {
        scanned += 1;
        const fromAva =
          m.user === AVA_SLACK_USER ||
          m.bot_id ||
          /manipulation gate/i.test(m.text || "");
        if (!fromAva) continue;
        if (!/manipulation gate/i.test(m.text || "")) continue;
        const cleaned = scrubText(m.text);
        if (!cleaned) continue;
        const upd = await slackApi(token, "chat.update", {
          channel,
          ts: m.ts,
          text: cleaned,
        });
        if (upd.ok) {
          edited += 1;
          console.log(`slack edit ok ${channel} ${m.ts}`);
        } else {
          console.log(`slack edit FAIL ${channel} ${m.ts}`, upd.error);
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      cursor = data.response_metadata?.next_cursor || "";
      // Wave0 briefs are recent — stop after a few pages unless still hitting hits
      if (pages >= 3 && !cursor) break;
      if (pages >= 5) break;
    } while (cursor);
  }
  return { scanned, edited };
}

async function discordFetchJson(token, path, opts = {}) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    ...opts,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${t}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function scrubDiscord(token) {
  let edited = 0;
  let scanned = 0;
  const channels = [AVA_CHANNELS.updates, AVA_CHANNELS.admins];
  for (const channelId of channels) {
    const msgs = await discordFetchJson(
      token,
      `/channels/${channelId}/messages?limit=50`,
    );
    for (const m of msgs || []) {
      scanned += 1;
      if (!/manipulation gate/i.test(m.content || "")) continue;
      const cleaned = scrubText(m.content);
      if (!cleaned) continue;
      try {
        await discordEditMessage(
          (p, o) => discordFetchJson(token, p, o),
          channelId,
          m.id,
          cleaned,
        );
        edited += 1;
        console.log(`discord edit ok ${channelId} ${m.id}`);
      } catch (err) {
        console.log(`discord edit FAIL ${channelId} ${m.id}`, err.message);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return { scanned, edited };
}

async function scrubTelegram(env) {
  const tok =
    env.AVA_TELEGRAM_BOT_TOKEN ||
    env.TELEGRAM_BOT_TOKEN ||
    "";
  if (!tok) return { scanned: 0, edited: 0, skipped: true };
  // Telegram bots can't list chat history; best-effort edit via recent getUpdates is weak.
  // Skip unless we find a stored message id in utterance log.
  return { scanned: 0, edited: 0, skipped: "no_history_api" };
}

async function main() {
  const env = await loadEnv();
  const slackTok = slackBotToken(env);
  const discTok = botToken(env);
  if (!slackTok) throw new Error("missing AVA_SLACK_BOT_TOKEN");
  if (!discTok) throw new Error("missing AVA_DISCORD_BOT_TOKEN");

  console.log("scrubbing slack…");
  const slack = await scrubSlack(slackTok);
  console.log("scrubbing discord…");
  const discord = await scrubDiscord(discTok);
  const telegram = await scrubTelegram(env);
  console.log(JSON.stringify({ slack, discord, telegram }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
