/**
 * Backfill Discord reactor identities on Ava posts, rebuild quality scores,
 * and POST them into api.rootmc.net governance vote-factor bonuses.
 *
 * Usage:
 *   node scripts/backfill-reaction-vote-factors.mjs
 *   node scripts/backfill-reaction-vote-factors.mjs --sync-only
 *   node scripts/backfill-reaction-vote-factors.mjs --limit 40
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv, AVA_CHANNELS } from "../src/config.mjs";
import { storePaths } from "../src/store.mjs";
import { makeFetchJson } from "../src/discordApi.mjs";
import {
  enrichDiscordMessageReactors,
  listReactorVoteFactors,
  rebuildReactorIndexFromDisk,
  refreshReactionDerived,
} from "../src/reactionStore.mjs";
import { pushReactorVoteFactorsToApi } from "../src/governanceClient.mjs";

await loadEnv();
storePaths();

const syncOnly = process.argv.includes("--sync-only");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limitIdx = process.argv.indexOf("--limit");
const limit = Number(
  limitArg?.split("=")[1] ||
    (limitIdx >= 0 ? process.argv[limitIdx + 1] : 0) ||
    0,
);

const token = process.env.AVA_DISCORD_BOT_TOKEN;
const botId =
  process.env.AVA_DISCORD_APPLICATION_ID || "1532751879875072070";
if (!token && !syncOnly) {
  console.error("AVA_DISCORD_BOT_TOKEN required (or use --sync-only)");
  process.exit(1);
}

const fetchJson = token ? makeFetchJson(token) : null;
const reactionsDir = path.join(storePaths().dir, "reactions", "messages");

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function enrichFromDisk() {
  let files = [];
  try {
    files = fs.readdirSync(reactionsDir).filter((f) => f.endsWith(".json"));
  } catch {
    files = [];
  }

  const candidates = [];
  for (const f of files) {
    const rec = readJson(path.join(reactionsDir, f), null);
    if (!rec?.messageId || !rec?.channelId) continue;
    if (rec.surface && rec.surface !== "discord") continue;
    const total = Number(rec.totals?.all || 0);
    if (total <= 0) continue;
    const reactorN = Object.keys(rec.reactors || {}).length;
    // Prefer messages still missing reactor maps
    candidates.push({
      rec,
      reactorN,
      need: reactorN === 0 || reactorN < Math.min(total, 5),
    });
  }
  candidates.sort((a, b) => Number(b.need) - Number(a.need) || b.rec.totals.all - a.rec.totals.all);
  const work = limit > 0 ? candidates.slice(0, limit) : candidates;

  let enriched = 0;
  let skipped = 0;
  let failed = 0;
  for (const { rec } of work) {
    try {
      const message = await fetchJson(
        `/channels/${rec.channelId}/messages/${rec.messageId}`,
      );
      if (!message?.id) {
        skipped += 1;
        continue;
      }
      // Force author id to Ava for older stored rows if fetch returns it
      const msg = {
        ...message,
        author: message.author || { id: botId },
      };
      if (String(msg.author?.id) !== String(botId)) {
        skipped += 1;
        continue;
      }
      await enrichDiscordMessageReactors(fetchJson, {
        channelId: rec.channelId,
        message: msg,
        avaBotId: botId,
        sleepMs: 280,
      });
      enriched += 1;
      if (enriched % 10 === 0) {
        console.log(`enriched ${enriched}/${work.length}…`);
      }
    } catch (err) {
      failed += 1;
      console.warn("enrich fail", rec.messageId, err.message);
    }
  }
  return { candidates: candidates.length, work: work.length, enriched, skipped, failed };
}

async function enrichFreshChannels() {
  const channels = [
    AVA_CHANNELS.general,
    AVA_CHANNELS.admins,
    AVA_CHANNELS.updates,
    AVA_CHANNELS.development || "1532929974154166522",
    "1532929974154166522",
    "1520665313631408251",
    "1516108586307158088",
    "1516121832493678612",
    "1532904783030128790",
  ].filter(Boolean);
  const unique = [...new Set(channels.map(String))];
  let touched = 0;
  for (const channelId of unique) {
    try {
      const messages = await fetchJson(
        `/channels/${channelId}/messages?limit=50`,
      );
      if (!Array.isArray(messages)) continue;
      for (const m of messages) {
        if (String(m?.author?.id) !== String(botId)) continue;
        if (!m.reactions?.length) continue;
        await enrichDiscordMessageReactors(fetchJson, {
          channelId,
          message: m,
          avaBotId: botId,
          sleepMs: 280,
        });
        touched += 1;
      }
      console.log("channel enrich", channelId, "ava posts with reactions:", touched);
    } catch (err) {
      console.warn("channel", channelId, err.message);
    }
  }
  return { touched };
}

let disk = { candidates: 0, work: 0, enriched: 0, skipped: 0, failed: 0 };
let fresh = { touched: 0 };
let slack = null;

if (!syncOnly) {
  console.log("Enriching Discord reactors from stored Ava messages…");
  disk = await enrichFromDisk();
  console.log("disk enrich", disk);
  console.log("Enriching recent Ava posts in watch channels…");
  fresh = await enrichFreshChannels();
  try {
    const { harvestReactionsFromLocalSlackArchives: harvestSlack } =
      await import("../src/slackChannelArchive.mjs");
    slack = harvestSlack(process.env.AVA_SLACK_BOT_USER_ID || "U0BMBNYPYA2");
    console.log("slack archives", slack);
  } catch (err) {
    console.warn("slack harvest:", err.message);
  }
  refreshReactionDerived();
}

const index = rebuildReactorIndexFromDisk();
const factors = listReactorVoteFactors();
console.log(
  `reactor index: ${index.userCount} users · ${factors.length} Discord factors`,
);
console.log(
  "top factors",
  factors.slice(0, 8).map((f) => ({
    id: f.discord_user_id,
    score: f.quality_score,
    good: f.good_count,
    bad: f.bad_count,
  })),
);

const sync = await pushReactorVoteFactorsToApi(factors);
console.log("api sync", sync);

if (!sync?.ok) {
  process.exitCode = 1;
}
