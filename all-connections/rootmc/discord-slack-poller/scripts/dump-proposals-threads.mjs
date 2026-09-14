/**
 * Dump active Discord proposal threads into channels status pack.
 */
import fs from "node:fs";
import path from "node:path";

const OUT = "C:\\Users\\rootr\\OneDrive\\Desktop\\channels status";
const RAW = path.join(OUT, "_raw", "discord", "proposals-threads");
const MD = path.join(OUT, "discord", "proposals");
const GUILD = "1516108585740800042";
const FORUM = "1526664180491358419";
const AVA = "1532751879875072070";

fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(MD, { recursive: true });

function parseEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = parseEnv("E:\\.1 Work Stations\\RootMC\\.env");
const token = (env.AVA_DISCORD_BOT_TOKEN || env.DISCORD_ROOTMC_BOT_TOKEN || "").replace(/^Bot\s+/i, "");

async function api(pathname) {
  const res = await fetch(`https://discord.com/api/v10${pathname}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, (data.retry_after || 1) * 1000 + 250));
    return api(pathname);
  }
  return { ok: res.ok, status: res.status, data };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const active = await api(`/guilds/${GUILD}/threads/active`);
if (!active.ok) {
  console.error("active threads failed", active.status, active.data);
  process.exit(1);
}
const threads = (active.data.threads || []).filter((t) => t.parent_id === FORUM);
console.log("proposal threads", threads.length);

const idx = [
  "# Discord Proposals Forum — Active Threads",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Active threads under forum \`${FORUM}\`: **${threads.length}**`,
  "",
];

for (const t of threads) {
  console.log("dump", t.name);
  const msgs = [];
  let before = null;
  for (let i = 0; i < 10; i++) {
    const q = before
      ? `/channels/${t.id}/messages?limit=100&before=${before}`
      : `/channels/${t.id}/messages?limit=100`;
    const r = await api(q);
    if (!r.ok || !Array.isArray(r.data) || !r.data.length) break;
    msgs.push(...r.data);
    before = r.data[r.data.length - 1].id;
    if (r.data.length < 100) break;
    await sleep(300);
  }
  const safe = String(t.name).replace(/[^\w.-]+/g, "_");
  const pack = {
    thread: {
      id: t.id,
      name: t.name,
      parent_id: t.parent_id,
      archived: t.thread_metadata?.archived,
      locked: t.thread_metadata?.locked,
    },
    fetched: msgs.length,
    messages: msgs.map((m) => ({
      id: m.id,
      at: m.timestamp,
      author: m.author?.username,
      authorId: m.author?.id,
      bot: Boolean(m.author?.bot),
      content: String(m.content || "").slice(0, 1000),
    })),
  };
  fs.writeFileSync(path.join(RAW, `${safe}__${t.id}.json`), JSON.stringify(pack, null, 2));

  const ava = pack.messages.filter((m) => m.authorId === AVA);
  const md = [
    `# PROP — ${t.name}`,
    "",
    `| Field | Value |`,
    `|------|-------|`,
    `| Thread ID | \`${t.id}\` |`,
    `| Parent forum | \`${FORUM}\` |`,
    `| Fetched | ${msgs.length} |`,
    `| Ava posts | ${ava.length} |`,
    `| Archived | ${t.thread_metadata?.archived} |`,
    "",
    "## Current / needs",
    "",
    "- Review whether vote reactions still valid / expired.",
    "- Purge dig-theater if present in PROP body.",
    "- Ensure catchup/followup-scan does not paste into PROP threads.",
    "",
    "## Messages (newest first, truncated)",
    "",
    ...pack.messages.slice(0, 40).map(
      (m) =>
        `- \`${m.at}\` **${m.author}**: ${String(m.content || "").replace(/\n/g, " ").slice(0, 260)}`,
    ),
    "",
  ];
  fs.writeFileSync(path.join(MD, `${safe}__${t.id}.md`), md.join("\n"));
  idx.push(`- [${t.name}](proposals/${safe}__${t.id}.md) — ${msgs.length} msgs · Ava ${ava.length}`);
  await sleep(350);
}

fs.writeFileSync(path.join(OUT, "discord", "PROPOSALS-INDEX.md"), idx.join("\n") + "\n");
console.log("done");
