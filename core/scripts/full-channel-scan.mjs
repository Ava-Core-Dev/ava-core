import { loadEnv, botToken, DISCORD_API, ROOTMC_GUILD_ID, AVA_CHANNELS } from "../src/config.mjs";
import { authHeaders } from "../src/discordApi.mjs";
import { isHushed } from "../src/store.mjs";
import fs from "node:fs";
import path from "node:path";

const AVA = "1532751879875072070";
const env = await loadEnv();
const h = authHeaders(botToken(env));

const channels = await (
  await fetch(`${DISCORD_API}/guilds/${ROOTMC_GUILD_ID}/channels`, { headers: h })
).json();

const textChannels = channels.filter((c) => c.type === 0 || c.type === 5);
const forums = channels.filter((c) => c.type === 15);

async function recent(channelId, limit = 40) {
  const res = await fetch(
    `${DISCORD_API}/channels/${channelId}/messages?limit=${limit}`,
    { headers: h },
  );
  if (!res.ok) return { error: res.status, msgs: [] };
  return { error: null, msgs: await res.json() };
}

async function forumThreads(forumId) {
  const active = await fetch(
    `${DISCORD_API}/guilds/${ROOTMC_GUILD_ID}/threads/active`,
    { headers: h },
  );
  if (!active.ok) return [];
  const data = await active.json();
  return (data.threads || []).filter((t) => t.parent_id === forumId);
}

const openAsks = [];
const channelSummaries = [];
const mentions = [];

for (const c of textChannels) {
  const { error, msgs } = await recent(c.id, 35);
  if (error) {
    channelSummaries.push({ id: c.id, name: c.name, error });
    continue;
  }
  const last = msgs[0];
  const avaMentionMsgs = msgs.filter(
    (m) =>
      m.author?.id !== AVA &&
      (m.mentions?.some((u) => u.id === AVA) ||
        (m.content || "").includes(`<@${AVA}>`) ||
        (m.content || "").includes(`<@!${AVA}>`)),
  );
  for (const m of avaMentionMsgs) {
    const answered = msgs.some(
      (r) =>
        r.author?.id === AVA &&
        BigInt(r.id) > BigInt(m.id) &&
        (r.message_reference?.message_id === m.id ||
          BigInt(r.id) - BigInt(m.id) < 50_000_000_000_000n),
    );
    // tighter: Ava reply referencing OR any Ava msg within ~10 messages after
    const idx = msgs.findIndex((x) => x.id === m.id);
    const after = msgs.slice(0, idx).reverse(); // msgs are newest-first; slice before idx is newer
    const newer = msgs.filter((x) => BigInt(x.id) > BigInt(m.id));
    const avaAfter = newer.some((x) => x.author?.id === AVA);
    const refReply = newer.some(
      (x) => x.author?.id === AVA && x.message_reference?.message_id === m.id,
    );
    mentions.push({
      channel: c.name,
      channelId: c.id,
      id: m.id,
      author: m.author?.username,
      content: (m.content || "").slice(0, 160),
      answered: refReply || avaAfter,
      refReply,
    });
    if (!refReply && !avaAfter) {
      openAsks.push({
        channel: c.name,
        channelId: c.id,
        id: m.id,
        author: m.author?.username,
        content: (m.content || "").slice(0, 200),
      });
    }
  }
  channelSummaries.push({
    id: c.id,
    name: c.name,
    lastAuthor: last?.author?.username,
    lastPreview: (last?.content || "").replace(/\n/g, " ").slice(0, 100),
    lastId: last?.id,
    avaMentions: avaMentionMsgs.length,
  });
}

// proposals forum threads
const proposalThreads = await forumThreads(AVA_CHANNELS.proposals);
const proposalNotes = [];
for (const t of proposalThreads.slice(0, 15)) {
  const { msgs } = await recent(t.id, 5);
  const starter = msgs[msgs.length - 1] || msgs[0];
  proposalNotes.push({
    id: t.id,
    name: t.name,
    messageCount: t.message_count,
    last: (msgs[0]?.content || "").replace(/\n/g, " ").slice(0, 120),
  });
}

const jobsDir = path.resolve("../../Server Handoffs/Ava Ivy/data/jobs");
const jobs = fs.existsSync(jobsDir)
  ? fs
      .readdirSync(jobsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(jobsDir, f), "utf8")))
  : [];

const out = {
  at: new Date().toISOString(),
  hushed: isHushed(),
  jobs: jobs.map((j) => ({ id: j.id, status: j.status, title: j.title })),
  openAsks,
  mentionsUnanswered: openAsks,
  mentionsAll: mentions.filter((m) => !m.answered),
  channelSummaries,
  proposalThreads: proposalNotes,
  watch: {
    development: AVA_CHANNELS.development,
    updates: AVA_CHANNELS.updates,
  },
};

const dest = path.resolve("../../Server Handoffs/Ava Ivy/data/full-scan.json");
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log("wrote", dest);
