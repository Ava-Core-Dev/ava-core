/**
 * Operator: wake Ava + catch-up digest + official queues.
 * Usage: node scripts/wake-and-catchup.mjs
 */
import {
  loadEnv,
  botToken,
  AVA_CHANNELS,
  watchChannels,
  avaBotAppId,
} from "../src/config.mjs";
import { makeFetchJson } from "../src/discordApi.mjs";
import { postAvaDiscord } from "../src/avaPost.mjs";
import {
  clearAsleep,
  isAsleep,
  loadSleepState,
  catchUpSinceSleep,
  discordStamp,
} from "../src/sleepMode.mjs";
import { setHushed, storePaths, pushStatusEvent } from "../src/store.mjs";
import { processPendingProposalIdeas } from "../src/proposalIdeas.mjs";
import { processPendingFeedback } from "../src/feedbackInbox.mjs";
import { flushPendingLessons } from "../src/localBrain.mjs";

await loadEnv();
storePaths();

const env = await loadEnv();
const token = botToken(env);
const fetchJson = makeFetchJson(token);
const botAppId = avaBotAppId(env);
const announce =
  AVA_CHANNELS.development ||
  AVA_CHANNELS.avaHome ||
  AVA_CHANNELS.admins;

const wasAsleep = isAsleep();
const prev = wasAsleep ? loadSleepState() : loadSleepState();
setHushed(false, "operator wake-and-catchup");
if (wasAsleep) clearAsleep("operator wake-and-catchup");
else clearAsleep("operator catch-up (force clear sleep.json)");

try {
  flushPendingLessons();
} catch (err) {
  console.warn("flush lessons:", err.message);
}

const sleepSince =
  prev?.sleepSince || prev?.lastSleepSince || Date.now() - 12 * 60 * 60 * 1000;

const watch = watchChannels(env);
const { digest, triggers } = await catchUpSinceSleep(fetchJson, {
  channelIds: watch.length ? watch : [announce],
  sleepSince,
  botAppId,
  limit: 40,
});

const msgCount = digest.reduce((n, d) => n + (d.count || 0), 0);
pushStatusEvent(
  `operator wake catch-up · ${msgCount} msgs · ${triggers.length} summons`,
);

let propNote = "";
try {
  const r = await processPendingProposalIdeas({ reason: "wake-catchup" });
  if (r.formalized || r.failed) {
    propNote = `official /proposal queue: **${r.formalized || 0}** formalized, ${r.failed || 0} failed`;
    console.log(propNote, r);
  }
} catch (err) {
  console.warn("proposals:", err.message);
}

let feedbackNote = "";
try {
  const r = await processPendingFeedback({ reason: "wake-catchup" });
  if (r?.seen) {
    feedbackNote = `/feedback inbox: **${r.seen}** seen`;
    console.log(feedbackNote, r);
  }
} catch (err) {
  console.warn("feedback:", err.message);
}

const lines = digest
  .filter((d) => d.count)
  .slice(0, 8)
  .map((d) => {
    const sample = d.samples?.[0];
    return (
      `• <#${d.channelId}> — **${d.count}** while I was under` +
      (sample ? ` _(e.g. ${sample.author}: ${String(sample.content || "").slice(0, 80)})_` : "")
    );
  });

const body = [
  "i'm up for a bit — catching up on everything.",
  wasAsleep
    ? `was dreaming (eta was ${discordStamp(prev?.wakeAt || prev?.lastWakeAt)}). operator woke me early.`
    : "sleep flag cleared · running a full catch-up pass now.",
  "",
  lines.length
    ? ["**overnight / missed chat:**", ...lines].join("\n")
    : "_no big missed piles in watched channels — queues next._",
  triggers.length ? `\n**summons while asleep:** ${triggers.length}` : "",
  propNote ? `\n${propNote}` : "",
  feedbackNote ? `\n${feedbackNote}` : "",
  "",
  "ping me if you need something while i'm hot. i'll dig / dream as the surface asks.",
]
  .filter(Boolean)
  .join("\n")
  .slice(0, 1900);

const posted = await postAvaDiscord({
  channelId: announce,
  content: body,
  kind: "catchup",
  source: "wake-and-catchup-cli",
});

console.log("posted", posted?.id || posted, "channel", announce);
console.log("digest channels", digest.length, "msgs", msgCount, "summons", triggers.length);
console.log("asleep now?", isAsleep());
