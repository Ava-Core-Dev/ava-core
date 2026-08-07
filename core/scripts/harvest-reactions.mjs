/**
 * One-shot: harvest Discord + Slack reactions on Ava's posts into the reaction store.
 * Usage: node scripts/harvest-reactions.mjs
 */
import { loadEnv, AVA_CHANNELS, slackBotUserId } from "../src/config.mjs";
import { storePaths } from "../src/store.mjs";
import {
  harvestReactionsFromMessages,
  harvestSlackReactionsFromMessages,
  loadReactionSummary,
  loadGoodExamples,
  refreshReactionDerived,
} from "../src/reactionStore.mjs";
import { harvestReactionsFromLocalSlackArchives } from "../src/slackChannelArchive.mjs";

await loadEnv();
storePaths();

const token = process.env.AVA_DISCORD_BOT_TOKEN;
const botId =
  process.env.AVA_DISCORD_APPLICATION_ID || "1532751879875072070";
const headers = { Authorization: `Bot ${token}` };

const channels = [
  AVA_CHANNELS.general,
  AVA_CHANNELS.admins,
  AVA_CHANNELS.updates,
  AVA_CHANNELS.development || "1532929974154166522",
  "1532929974154166522",
  "1520665313631408251",
  "1516108586307158088",
  "1516121832493678612",
  "1532904783030128790", // Melee DM
].filter(Boolean);
const unique = [...new Set(channels.map(String))];

let discordTouched = 0;
for (const channelId of unique) {
  try {
    const r = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=50`,
      { headers },
    );
    const messages = await r.json();
    if (!Array.isArray(messages)) {
      console.warn("discord", channelId, messages?.message || r.status);
      continue;
    }
    const { touched } = harvestReactionsFromMessages(
      channelId,
      messages,
      botId,
      { surface: "discord" },
    );
    discordTouched += touched;
    console.log("discord", channelId, "touched", touched);
  } catch (err) {
    console.warn("discord", channelId, err.message);
  }
}

const slack = harvestReactionsFromLocalSlackArchives(
  slackBotUserId() || "U0BMBNYPYA2",
);
console.log("slack archives", slack);

// Also live-fetch key Slack channels
const slackTok = process.env.AVA_SLACK_BOT_TOKEN;
const avaSlack = slackBotUserId() || "U0BMBNYPYA2";
if (slackTok) {
  for (const ch of [
    "C0BMDLAS5QS",
    "C0BMCPMDDQR",
    "C0BM4P3GVDX",
  ]) {
    try {
      const data = await fetch("https://slack.com/api/conversations.history", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${slackTok}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ channel: ch, limit: "100" }),
      }).then((x) => x.json());
      if (!data.ok) {
        console.warn("slack live", ch, data.error);
        continue;
      }
      const { touched } = harvestSlackReactionsFromMessages(
        ch,
        data.messages || [],
        avaSlack,
      );
      console.log("slack live", ch, "touched", touched);
    } catch (err) {
      console.warn("slack live", ch, err.message);
    }
  }
}

const summary = refreshReactionDerived();
const goods = loadGoodExamples();
console.log(
  JSON.stringify(
    {
      discordTouched,
      slackArchives: slack,
      summary: {
        total: summary.totalReactions,
        good: summary.good,
        bad: summary.bad,
        neutral: summary.neutral,
        messagesTracked: summary.messagesTracked,
        top: summary.byEmoji,
      },
      goodExamples: (goods.examples || []).slice(0, 8).map((g) => ({
        surface: g.surface,
        good: g.good,
        preview: g.preview?.slice(0, 100),
      })),
    },
    null,
    2,
  ),
);
