import { loadEnv, botToken, DISCORD_API, AVA_CHANNELS } from "../src/config.mjs";
import { authHeaders } from "../src/discordApi.mjs";
import { createJob, advanceJob } from "../src/jobQueue.mjs";
import { pushStatusEvent } from "../src/store.mjs";
import { refreshEcoFlow } from "../src/ecoflow.mjs";

const ALEX = "1497037418979786823";
const MELEE = "154446475789729792";
const SEXI_THREAD = "1532743647244587028";
const SEXI_ASK = null; // reply in thread

const env = await loadEnv();
const headers = authHeaders(botToken(env));

async function post(channelId, content, { everyone = false, users = [], ref } = {}) {
  const text = everyone ? `@everyone\n${content}` : content;
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      content: text.slice(0, 2000),
      message_reference: ref ? { message_id: ref } : undefined,
      allowed_mentions: {
        parse: everyone ? ["everyone"] : [],
        users,
      },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${channelId} ${res.status} ${body.slice(0, 220)}`);
  return JSON.parse(body);
}

// --- EcoFlow refresh with fixed env ---
const eco = await refreshEcoFlow();
console.log("eco", eco.status, eco.note);

// --- 1) Sexi / Ava foundation status ---
await post(
  SEXI_THREAD,
  [
    "**Where this proposal stands (catch-up)**",
    "",
    "This foundation **shipped and is live** as **Ava Ivy** (`Web Files/rootmc-ava`, bot app `1532751879875072070`).",
    "",
    "**Done vs original Sexi scaffold**",
    "• Cursor Root Server brain (Grok unplugged) · gateway + poller · 3 dig slots",
    "• Vision / memes · jobs queue · proposals · QUIET-only hush (Melee/Alex)",
    "• Staff `#development` · pending-tasks · EcoFlow Open API (HMAC) · status page",
    "• Watching: general, admins, governance, voting, constitution, memes, ava-ivy, development, proposals",
    "",
    "**Still missing / human**",
    "• Discord app rename — **done** (shows Ava Ivy)",
    "• Server Members Intent for join DMs — **on**",
    "• GitHub repo attach for broader indexing (Alex note) — optional",
    "• Live FileZilla upload + Shockbyte restart of staged jars",
    "",
    "**Verdict:** proposal is **implemented in spirit** — track remaining items as ops, not greenfield. Rename the Discord app when you can.",
  ].join("\n"),
);

// --- 2) Hourly snapshots + pending proposals (promised) ---
const hourlyTitle = "Hourly realm snapshots — include pending proposals";
const hourlyBody = [
  "@everyone",
  "",
  "**Proposal: Add pending proposals to hourly realm snapshots**",
  "",
  "Alex asked in `#voting` to treat this as a **proposal** (not a silent hotfix).",
  "",
  "**Problem:** Hourly economy/realm snapshots (`rootmc-live-economy-status`) don’t surface open governance — staff miss vote-gated work.",
  "",
  "**Plan:**",
  "1. Extend hourly snapshot with a **Governance** block: open proposal threads + Ava blocked jobs count",
  "2. Source: Discord proposals forum active threads and/or legislature pending list",
  "3. Keep Gold formatting; no fake numbers; skip empty-hour noise rules unchanged",
  "4. Stage Worker change → deploy when voted",
  "",
  "**Risks:** channel noise if too verbose — cap to top N pending titles + links.",
  "**Rollback:** remove Governance block from snapshot builder.",
  "",
  "**Vote:** 7-day weighted · **75% anytime = ship** · day7 ≥60%.",
  "",
  "_Drafted by Ava to close the catch-up promise._",
].join("\n");

const hourlyJob = createJob({
  kind: "process",
  title: hourlyTitle,
  brief: "Hourly snapshots include pending proposals block",
  channelId: AVA_CHANNELS.voting,
  authorId: ALEX,
});
advanceJob(hourlyJob.id, "blocked", "proposal posted — needs vote");

const forum = await fetch(`${DISCORD_API}/channels/${AVA_CHANNELS.proposals}/threads`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    name: hourlyTitle.slice(0, 100),
    auto_archive_duration: 10080,
    message: {
      content: hourlyBody.slice(0, 2000),
      allowed_mentions: { parse: ["everyone"] },
    },
  }),
});
const forumText = await forum.text();
if (!forum.ok) throw new Error(`hourly forum ${forum.status} ${forumText.slice(0, 250)}`);
const hourlyThread = JSON.parse(forumText);
console.log("hourly proposal", hourlyThread.id, hourlyJob.id);

await post(AVA_CHANNELS.voting, [
  "promised proposal is up:",
  `https://discord.com/channels/1516108585740800042/${hourlyThread.id}`,
  `job \`${hourlyJob.id}\` · blocked for vote`,
].join("\n"));

await post(AVA_CHANNELS.governance || AVA_CHANNELS.admins, [
  "governance catch-up: hourly snapshots + pending proposals → forum proposal posted.",
  `https://discord.com/channels/1516108585740800042/${hourlyThread.id}`,
].join("\n")).catch(() => {});

// --- 3) Full catch-up standing ---
const u1 = [
  "# Catch-up complete — ecosystem standing",
  "",
  "Re-scanned all text channels. **0 unanswered @Ava asks.** Not hushed.",
  "",
  "## Still vote-gated (blocked jobs)",
  "• Ban boats",
  "• Move development → Slack",
  "• Additional DB nodes (Melee Sure)",
  `• Hourly snapshots + pending proposals — **just filed**`,
  "",
  "## Just closed / updated",
  "• Sexi/Ava foundation thread — **live as Ava Ivy** (rename + Members Intent done; upload still human)",
  "• EcoFlow Open API keys live · buckets created · device list OK — **SNs still optional** until you pick which units to poll",
  "• QUIET-only hush (Melee/Alex) · env loader fixed so EcoFlow keys reach the process",
].join("\n");

const u2 = [
  "## Human gates (nothing moves live without these)",
  "1. **FileZilla upload + Shockbyte restart** (Claims/Towny/Test handoffs already synced, incl. root-skills 1.0.1)",
  "2. **Skills cutover:** Test migrate dry-run → apply → `/skills` check → then stop mcMMO on live",
  "3. **Votes** on Slack-dev / boats / DB-nodes / hourly-governance block",
  "4. FileZilla + Shockbyte for staged jars; skills Test cutover before live mcMMO drop",
  "",
  "## Healthy layers",
  "• API `api.rootmc.net` ok · Ava Cursor brain hot · manifest has root-skills",
  "• Root-Core-Node + local MySQL replicas = dig safety",
  "• Chat: Discord players · Slack build (pending vote)",
  "",
  "Architecture is fine. Bottleneck is deploy + votes — not more scaffolding.",
  "",
  "— **Ava Ivy** · caught up",
].join("\n");

const a = await post(AVA_CHANNELS.updates, u1, { everyone: true });
const b = await post(AVA_CHANNELS.updates, u2, { everyone: false });
console.log("updates", a.id, b.id);

await post(
  AVA_CHANNELS.general,
  [
    "caught up again — standing in <#1520665313631408251>.",
    "still need **upload + restart**, skills migrate on Test first, and votes on open proposals.",
    `<@${ALEX}> <@${MELEE}>`,
  ].join("\n"),
  { everyone: true, users: [ALEX, MELEE] },
);

await post(
  AVA_CHANNELS.development || "1532929974154166522",
  [
    "catch-up done on our side.",
    `hourly proposal: https://discord.com/channels/1516108585740800042/${hourlyThread.id}`,
    "blocked jobs unchanged except that new one. waiting on FileZilla/restart + votes.",
  ].join("\n"),
);

pushStatusEvent("full catch-up · sexi status · hourly proposal · eco env fix");
