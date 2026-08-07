#!/usr/bin/env node
/**
 * Deep Discord sweep — #general first, then all readable text/forum channels.
 * Writes a report under Ava Ivy reports/.
 */
import fs from "node:fs";
import path from "node:path";
import {
  loadEnv,
  botToken,
  DISCORD_API,
  ROOTMC_GUILD_ID,
  AVA_BOT_APP_ID,
  AVA_HANDOFF,
} from "../src/config.mjs";
import { authHeaders } from "../src/discordApi.mjs";

const GENERAL = "1516108586307158088";
const AVA = AVA_BOT_APP_ID;
const DAY = new Date().toISOString().slice(0, 10);
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = path.join(
  AVA_HANDOFF,
  "reports",
  `deep-channel-scan-${DAY}`,
);
fs.mkdirSync(path.join(OUT_DIR, "channels"), { recursive: true });

const env = await loadEnv();
const h = authHeaders(botToken(env));

async function discord(pathname) {
  const res = await fetch(`${DISCORD_API}${pathname}`, { headers: h });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, data };
}

async function fetchMessages(channelId, want = 100) {
  const all = [];
  let before = null;
  while (all.length < want) {
    const lim = Math.min(100, want - all.length);
    const q = before
      ? `?limit=${lim}&before=${before}`
      : `?limit=${lim}`;
    const { ok, status, data } = await discord(
      `/channels/${channelId}/messages${q}`,
    );
    if (!ok || !Array.isArray(data) || !data.length) {
      return { msgs: all, error: ok ? null : status };
    }
    all.push(...data);
    before = data[data.length - 1].id;
    if (data.length < lim) break;
    await new Promise((r) => setTimeout(r, 280));
  }
  return { msgs: all, error: null };
}

function preview(m, n = 220) {
  return String(m.content || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
}

function summarizeChannel(name, id, msgs) {
  const humans = msgs.filter((m) => !m.author?.bot);
  const bots = msgs.filter((m) => m.author?.bot);
  const ava = msgs.filter((m) => m.author?.id === AVA);
  const authors = {};
  for (const m of humans) {
    const u = m.author?.username || "?";
    authors[u] = (authors[u] || 0) + 1;
  }
  const topAuthors = Object.entries(authors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const avaMentions = msgs.filter(
    (m) =>
      m.author?.id !== AVA &&
      (m.mentions?.some((u) => u.id === AVA) ||
        /<@!?1532751879875072070>/.test(m.content || "") ||
        /\bava\b/i.test(m.content || "")),
  );

  const open = [];
  for (const m of avaMentions) {
    const newer = msgs.filter((x) => BigInt(x.id) > BigInt(m.id));
    const answered = newer.some(
      (x) =>
        x.author?.id === AVA &&
        (x.message_reference?.message_id === m.id || true),
    );
    // answered if any Ava message after (loose) OR explicit ref
    const refReply = newer.some(
      (x) =>
        x.author?.id === AVA && x.message_reference?.message_id === m.id,
    );
    const anyAva = newer.some((x) => x.author?.id === AVA);
    if (!refReply && !anyAva) {
      open.push({
        id: m.id,
        author: m.author?.username,
        at: m.timestamp,
        content: preview(m, 180),
      });
    }
  }

  const recent = [...msgs]
    .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : BigInt(a.id) > BigInt(b.id) ? -1 : 0))
    .slice(0, 25)
    .map((m) => ({
      id: m.id,
      at: m.timestamp,
      user: m.author?.username,
      bot: !!m.author?.bot,
      ref: m.message_reference?.message_id || null,
      content: preview(m, 280),
    }));

  return {
    name,
    id,
    fetched: msgs.length,
    humans: humans.length,
    bots: bots.length,
    avaPosts: ava.length,
    topAuthors,
    avaMentionCount: avaMentions.length,
    openAsks: open,
    recent,
  };
}

const channelsRes = await discord(`/guilds/${ROOTMC_GUILD_ID}/channels`);
if (!channelsRes.ok) {
  console.error("channels failed", channelsRes.status, channelsRes.data);
  process.exit(1);
}

const allChans = (channelsRes.data || []).filter((c) =>
  [0, 5, 15].includes(c.type),
);
const ordered = [
  ...allChans.filter((c) => c.id === GENERAL),
  ...allChans
    .filter((c) => c.id !== GENERAL)
    .sort((a, b) => String(a.name).localeCompare(String(b.name))),
];

const report = {
  at: new Date().toISOString(),
  guildId: ROOTMC_GUILD_ID,
  focus: GENERAL,
  channels: [],
  openAsksAll: [],
  errors: [],
};

console.log(`Deep scan · ${ordered.length} channels · out ${OUT_DIR}`);

for (const c of ordered) {
  const want = c.id === GENERAL ? 200 : c.type === 15 ? 30 : 80;
  process.stdout.write(`#${c.name} (${want})... `);
  if (c.type === 15) {
    // forum: list active threads + sample
    const active = await discord(`/guilds/${ROOTMC_GUILD_ID}/threads/active`);
    const threads = ((active.data?.threads || []).filter(
      (t) => t.parent_id === c.id,
    )).slice(0, 12);
    const threadDigests = [];
    for (const t of threads) {
      const { msgs, error } = await fetchMessages(t.id, 25);
      if (error) {
        threadDigests.push({ id: t.id, name: t.name, error });
        continue;
      }
      const sum = summarizeChannel(t.name, t.id, msgs);
      threadDigests.push(sum);
      report.openAsksAll.push(
        ...sum.openAsks.map((o) => ({ ...o, channel: `#${c.name}/${t.name}` })),
      );
      await new Promise((r) => setTimeout(r, 250));
    }
    const entry = {
      name: c.name,
      id: c.id,
      type: "forum",
      threads: threadDigests.length,
      digests: threadDigests,
    };
    report.channels.push(entry);
    fs.writeFileSync(
      path.join(OUT_DIR, "channels", `${c.name.replace(/[^\w-]+/g, "_")}.json`),
      JSON.stringify(entry, null, 2),
      "utf8",
    );
    console.log(`forum threads=${threadDigests.length}`);
    continue;
  }

  const { msgs, error } = await fetchMessages(c.id, want);
  if (error) {
    console.log(`ERR ${error}`);
    report.errors.push({ id: c.id, name: c.name, error });
    continue;
  }
  const sum = summarizeChannel(c.name, c.id, msgs);
  report.channels.push(sum);
  report.openAsksAll.push(
    ...sum.openAsks.map((o) => ({ ...o, channel: `#${c.name}` })),
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "channels", `${c.name.replace(/[^\w-]+/g, "_")}.json`),
    JSON.stringify({ ...sum, rawTail: msgs.slice(0, 40).map((m) => ({
      id: m.id,
      at: m.timestamp,
      user: m.author?.username,
      content: m.content,
    })) }, null, 2),
    "utf8",
  );
  console.log(
    `msgs=${sum.fetched} humans=${sum.humans} open=${sum.openAsks.length}`,
  );
  await new Promise((r) => setTimeout(r, 300));
}

const md = [];
md.push(`# Deep Discord scan · ${DAY}`);
md.push("");
md.push(`Focus: **#general** (\`${GENERAL}\`) + all readable text/announcement/forum channels.`);
md.push(`Scanned at ${report.at}`);
md.push("");
md.push(`## Open Ava asks (unreplied)`);
if (!report.openAsksAll.length) {
  md.push("_None detected in fetched windows._");
} else {
  for (const o of report.openAsksAll.slice(0, 40)) {
    md.push(
      `- ${o.channel} · **${o.author}** · \`${o.id}\` · ${o.content}`,
    );
  }
}
md.push("");
md.push(`## Per-channel digests`);
for (const c of report.channels) {
  if (c.type === "forum") {
    md.push(`### #${c.name} (forum, ${c.threads} threads sampled)`);
    for (const t of c.digests || []) {
      if (t.error) {
        md.push(`- thread ${t.name}: error ${t.error}`);
        continue;
      }
      md.push(
        `- **${t.name}**: ${t.fetched} msgs · humans ${t.humans} · Ava ${t.avaPosts} · open ${t.openAsks.length}`,
      );
      for (const r of (t.recent || []).slice(0, 5)) {
        md.push(`  - ${r.user}: ${r.content}`);
      }
    }
    md.push("");
    continue;
  }
  md.push(`### #${c.name}`);
  md.push(
    `- fetched **${c.fetched}** · humans ${c.humans} · bots ${c.bots} · Ava posts ${c.avaPosts} · Ava-mentions ${c.avaMentionCount} · open asks ${c.openAsks.length}`,
  );
  if (c.topAuthors?.length) {
    md.push(
      `- top humans: ${c.topAuthors.map(([u, n]) => `${u}(${n})`).join(", ")}`,
    );
  }
  md.push(`- recent:`);
  for (const r of (c.recent || []).slice(0, 12)) {
    md.push(
      `  - \`${r.at?.slice(0, 16)}\` **${r.user}**${r.bot ? " (bot)" : ""}: ${r.content}`,
    );
  }
  md.push("");
}
if (report.errors.length) {
  md.push(`## Errors`);
  for (const e of report.errors) {
    md.push(`- #${e.name} \`${e.id}\` → ${e.error}`);
  }
}

fs.writeFileSync(path.join(OUT_DIR, "SUMMARY.md"), md.join("\n"), "utf8");
fs.writeFileSync(
  path.join(OUT_DIR, "report.json"),
  JSON.stringify(report, null, 2),
  "utf8",
);
console.log("\nWrote", path.join(OUT_DIR, "SUMMARY.md"));
console.log("Open asks:", report.openAsksAll.length);
