/**
 * Broadcast surface-split rules to every Discord text channel Ava can post in
 * and every Slack channel she is a member of.
 *
 * Usage: node scripts/broadcast-surface-split.mjs
 */
import { loadEnv, botToken, slackBotToken, ROOTMC_GUILD_ID } from "../src/config.mjs";
import { makeFetchJson } from "../src/discordApi.mjs";
import { postAvaDiscord, postAvaSlack } from "../src/avaPost.mjs";
import { surfaceSplitAnnouncement } from "../src/surfaceRules.mjs";
import { sleep } from "../src/splitContent.mjs";

await loadEnv();
const token = botToken();
const slackTok = slackBotToken();
const fetchJson = makeFetchJson(token);

const discordBody = surfaceSplitAnnouncement({ everyone: true });
const slackBody = surfaceSplitAnnouncement({ everyone: false });

// --- Discord: all guild text channels ---
const channels = [];
let after = null;
for (let page = 0; page < 20; page++) {
  const q = after ? `?after=${after}&limit=100` : "?limit=100";
  // Discord GET /guilds/{id}/channels returns all at once (no pagination)
  break;
}
const all = await fetchJson(`/guilds/${ROOTMC_GUILD_ID}/channels`);
const TEXT_TYPES = new Set([0, 5]); // GUILD_TEXT, GUILD_ANNOUNCEMENT
for (const ch of all || []) {
  if (!TEXT_TYPES.has(ch.type)) continue;
  if (ch.nsfw && /ticket|appeal|mod-log|audit/i.test(ch.name || "")) {
    // still post — user asked every channel; skip only if we can't send
  }
  channels.push(ch);
}
channels.sort((a, b) => String(a.name).localeCompare(String(b.name)));

console.log(`Discord text/announce channels: ${channels.length}`);
const discordOk = [];
const discordFail = [];
for (const ch of channels) {
  try {
    const msg = await postAvaDiscord({
      channelId: ch.id,
      content: discordBody,
      kind: "surface_split_announce",
      source: "broadcast-surface-split",
      ackReact: false,
    });
    discordOk.push({ id: ch.id, name: ch.name, msg: msg?.id });
    console.log("discord ok", ch.name, msg?.id);
  } catch (err) {
    discordFail.push({ id: ch.id, name: ch.name, err: err.message });
    console.warn("discord fail", ch.name, err.message);
  }
  await sleep(450);
}

// --- Slack: all member channels ---
const slackOk = [];
const slackFail = [];
if (slackTok) {
  const slackChannels = [];
  let cursor = undefined;
  for (let i = 0; i < 30; i++) {
    const body = new URLSearchParams({
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "200",
    });
    if (cursor) body.set("cursor", cursor);
    const data = await fetch("https://slack.com/api/conversations.list", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${slackTok}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }).then((r) => r.json());
    if (!data.ok) {
      console.warn("slack list", data.error);
      break;
    }
    for (const ch of data.channels || []) {
      if (ch.is_member) slackChannels.push(ch);
    }
    cursor = data.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  console.log(`Slack member channels: ${slackChannels.length}`);
  for (const ch of slackChannels) {
    try {
      const data = await postAvaSlack({
        channelId: ch.id,
        content: slackBody,
        kind: "surface_split_announce",
        source: "broadcast-surface-split",
        ackReact: false,
      });
      slackOk.push({ id: ch.id, name: ch.name, ts: data?.ts });
      console.log("slack ok", ch.name, data?.ts);
    } catch (err) {
      slackFail.push({ id: ch.id, name: ch.name, err: err.message });
      console.warn("slack fail", ch.name, err.message);
    }
    await sleep(500);
  }
} else {
  console.warn("no AVA_SLACK_BOT_TOKEN — skipped Slack broadcast");
}

console.log(
  JSON.stringify(
    {
      discordOk: discordOk.length,
      discordFail: discordFail.length,
      slackOk: slackOk.length,
      slackFail: slackFail.length,
      discordFails: discordFail,
      slackFails: slackFail,
    },
    null,
    2,
  ),
);
