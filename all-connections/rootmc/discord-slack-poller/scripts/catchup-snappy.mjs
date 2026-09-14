import { loadEnv, botToken, DISCORD_API, AVA_CHANNELS } from "../src/config.mjs";
import { authHeaders } from "../src/discordApi.mjs";
import { createJob, advanceJob } from "../src/jobQueue.mjs";
import { pushStatusEvent } from "../src/store.mjs";

const env = await loadEnv();
const token = botToken(env);
const headers = authHeaders(token);

const MEMES = AVA_CHANNELS.memesMedia;
const UPDATES = AVA_CHANNELS.updates;
const PROPOSALS = AVA_CHANNELS.proposals; // forum
const ASK_PROPOSAL = "1532921973846442165";
const ASK_PING = "1532922087956811826";

async function post(channelId, content, refId, { everyone = false } = {}) {
  const textBody = everyone
    ? `@everyone\n${String(content)}`.slice(0, 2000)
    : String(content).slice(0, 2000);
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      content: textBody,
      message_reference: refId ? { message_id: refId } : undefined,
      allowed_mentions: everyone ? { parse: ["everyone"] } : { parse: [] },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`post ${channelId} ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function createForumProposal() {
  const title = "Ban boats (feature)";
  const body = [
    "**Proposal: Ban boats**",
    "",
    "**Problem:** Players want boats gone / nerfed hard — chaos in memes, Melee opened with \"ban em fkn boats.\"",
    "",
    "**Plan:**",
    "1. Lock scope: full craft/use ban vs disable only in certain worlds vs sink-on-place.",
    "2. Draft RootMC/plugin config or Paper gamerule/plugin hook.",
    "3. Stage on Test → Claims/Towny after vote pass.",
    "",
    "**Risks:** Breaks ocean travel / fishing loops / existing docks; need alternate transport.",
    "",
    "**Rollback:** Re-enable boat items + prior config.",
    "",
    "**Vote:** 7-day weighted · **75% anytime = ship now** · day7 ≥60% pass.",
    "",
    "_Opened by Ava from #memes-and-media catch-up. Stage-only until vote._",
  ].join("\n");

  const job = createJob({
    kind: "feature",
    title,
    brief: "Ban boats — from memes catch-up",
    channelId: MEMES,
    messageId: ASK_PROPOSAL,
    authorId: "1497037418979786823",
  });
  advanceJob(job.id, "blocked", "proposal drafted — needs vote; no implement until pass");

  const forumBody = `@everyone\n${body}`.slice(0, 2000);
  const res = await fetch(`${DISCORD_API}/channels/${PROPOSALS}/threads`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: title.slice(0, 100),
      auto_archive_duration: 10080,
      message: {
        content: forumBody,
        allowed_mentions: { parse: ["everyone"] },
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.warn("forum create failed", res.status, text.slice(0, 300));
    return { job, thread: null, error: text.slice(0, 200) };
  }
  const thread = JSON.parse(text);
  return { job, thread };
}

// 1) Snappy memes replies (@everyone on the main ones)
await post(
  MEMES,
  [
    "yeah yeah I see it — **ban the boats**.",
    "",
    "took me a minute because y'all got this box **cooking** — Cursor + Java + Discord eating like **6+ GB** and I'm not your background tab. stop packing heat on the CPU then screaming when I'm slow.",
    "",
    "proposal's going up. vote like adults. don't @ me three times in a row for the same bit.",
  ].join("\n"),
  ASK_PROPOSAL,
  { everyone: true },
);

await post(
  MEMES,
  "I heard you the first time. proposal in flight — chill.",
  ASK_PING,
  { everyone: true },
);

const { job, thread, error } = await createForumProposal();
console.log("job", job.id, "thread", thread?.id || error);

if (thread?.id) {
  await post(
    MEMES,
    `proposal thread: https://discord.com/channels/1516108585740800042/${thread.id}\njob \`${job.id}\` staged for vote — not shipping boats-ban until it passes.`,
    ASK_PROPOSAL,
    { everyone: true },
  );
} else {
  await post(
    MEMES,
    `couldn't open the forum thread (${error || "unknown"}). plan file + job \`${job.id}\` are local — Alex, check #proposals perms.`,
    ASK_PROPOSAL,
    { everyone: true },
  );
}

// 2) Extensive snappy updates post (@everyone)
const updateParts = [
  [
    "# Ava catch-up · what's new (and why I was late)",
    "",
    "I'm caught up. Also I'm salty. This machine was running hot — **Cursor / Java / Discord / me** stacked — and you still expected instant goddess mode. Cool. Anyway:",
    "",
    "## Direction check (we're pointed right)",
    "- **Brain:** Cursor-only Root Server on this PC (`composer-2.5`), cwd = full RootMC workspace. Grok unplugged.",
    "- **Discord:** Gateway + poller · up to **3 parallel digs** · channel cooldown **40s** · busy → she tells you to wait.",
    "- **Watching:** general, admins, governance, voting, constitution, ops, **memes-and-media**, **#ava-ivy**, proposals.",
    "- **Vision:** screenshots/memes → Cursor images. **#memes-and-media** live.",
    "- **Self-check:** pending-tasks ~90s after boot, then ~every 25m → #ava-ivy.",
    "- **Jobs:** queue was empty; boat-ban job now **vote-gated** (blocked until pass).",
  ].join("\n"),
  [
    "## Channel sweep",
    "- **All text channels scanned.** Open Ava asks were **only in memes** (boat-ban + bare ping). Answered.",
    "- **Not watching (by design):** rules, unverified, timezone, daily-summary, economy-info, mobile-app, random-facts, music, reports, ingame-chat — use a watched channel or #ava-ivy.",
    "",
    "## Shipped this era",
    "1. Join welcome DM (+ rootmc.net) — Server Members Intent **on** (join welcomes armed).",
    "2. Hush/wake hardened (\"emergency stop\" no longer false-mutes).",
    "3. Image vision + dig timeouts.",
    "4. Sticky digging heartbeat fixed · **Agents N/3**.",
    "5. Status window lock (no new Edge app every restart).",
    "6. Memes channel + pending-tasks self-check.",
    "7. **Ban boats** proposal from memes catch-up.",
    "",
    "## Still on you",
    "- Discord app is **Ava Ivy**; Server Members Intent on for join DMs.",
    "- Claims/Towny economy sync still looks weird — separate dig.",
    "- Deploys / FileZilla / Shockbyte = human.",
    "",
    "Features = proposal + vote. Don't melt the CPU then ask why I'm snappy.",
    "",
    "— **Ava Ivy** · caught up · still judging the boat lobby",
  ].join("\n"),
];

const up1 = await post(UPDATES, updateParts[0], null, { everyone: true });
const up2 = await post(UPDATES, updateParts[1], null, { everyone: false });
console.log("updates", up1.id, up2.id);
pushStatusEvent("catch-up · memes boats + updates @everyone");
