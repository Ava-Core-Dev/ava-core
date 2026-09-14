/**
 * Post "The real ones remain" — admin team recognition after character/activity review.
 *
 * Usage:
 *   node scripts/post-rootmc-admin-thanks-real-ones.mjs
 *   node scripts/post-rootmc-admin-thanks-real-ones.mjs --dry-run
 */
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";

const API = "https://discord.com/api/v10";
const GUILD_ID = "1516108585740800042";
const CHANNEL_ID = "1516121832493678612";
const ADMIN_ROLE_ID = "1516121138420252803";
/** Full Admin roster (verified via guild member search 2026-06-26). Merged with live search. */
const KNOWN_ADMIN_IDS = [
  "1497037418979786823", // Alexrs94
  "788153722198294618", // ZuppaFredda
  "1069028706187759756", // I'm Just Existent
  "1264007167661441177", // Khcr
  "259237332052344832", // yosh1024
];

const DRY_RUN = process.argv.includes("--dry-run");
const env = loadRootMcEnv();
const token = rootMcBotToken(env);

if (token.length < 40) {
  console.error("Need DISCORD_ROOTMC_BOT_TOKEN");
  process.exit(1);
}

const headers = {
  Authorization: `Bot ${token}`,
  "Content-Type": "application/json",
  "User-Agent": "RootRecord/rootmc-admin-thanks",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAdmins() {
  const byId = new Map();

  async function addMember(m) {
    if (!m?.user?.id) return;
    if (!(m.roles || []).includes(ADMIN_ROLE_ID)) return;
    const u = m.user;
    byId.set(u.id, {
      id: u.id,
      name: m.nick || u.global_name || u.username || u.id,
    });
  }

  for (const id of KNOWN_ADMIN_IDS) {
    const res = await fetch(`${API}/guilds/${GUILD_ID}/members/${id}`, { headers });
    if (res.ok) await addMember(await res.json());
    await sleep(200);
  }

  for (const c of "abcdefghijklmnopqrstuvwxyz0123456789") {
    const res = await fetch(
      `${API}/guilds/${GUILD_ID}/members/search?query=${encodeURIComponent(c)}&limit=100`,
      { headers },
    );
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      await sleep(Math.ceil((body.retry_after || 1) * 1000) + 300);
      continue;
    }
    const batch = await res.json().catch(() => []);
    if (!Array.isArray(batch)) continue;
    for (const m of batch) {
      await addMember(m);
    }
    await sleep(280);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function adminNotes(name) {
  const key = name.toLowerCase();
  if (key.includes("alexrs94") || key.includes("rootrecord")) {
    return "You set the tone — steady leadership, clear communication, and the work behind the scenes that keeps RootMC running. Thank you for showing up through the noise this week.";
  }
  if (key.includes("zuppa")) {
    return "Your dedication to the server and willingness to jump in when things need doing did not go unnoticed. Thank you for reliable conduct and honest communication.";
  }
  if (key.includes("existent") || key.includes("steve")) {
    return "Thank you for staying engaged, responding in good faith, and carrying yourself like someone who actually cares about this community.";
  }
  if (key.includes("khcr")) {
    return "Thank you for your patience, your presence when you could offer it, and the respect you bring to staff conversations and player-facing moments.";
  }
  if (key.includes("yosh")) {
    return "Thank you for consistent communication, thoughtful participation, and the character you showed throughout this review week.";
  }
  return "Thank you for the conduct, communication, and dedication you showed throughout this review week.";
}

function buildMessages(admins) {
  const intro = `# The real ones remain

This week we ran a **character and activity review** across RootMC — not a single checkbox, but a combined look at **staff poll responses**, **direct messages**, **in-game activity**, and **everyday communication** in general channels.

**Personal schedules, time zones, and real-life constraints were taken into account.** People are not expected to be online on the same clock. What mattered was conduct, honesty, and dedication when you *were* here.

The recent cleanup removed accounts that failed that bar across **multiple factors** — not one metric, not one bad day, and not rumor. It was deliberate, documented, and concluded only after those signals aligned.

**You passed.** The ${admins.length} of you still holding **Admin** earned it through behavior, conduct, and commitment. Thank you.`;

  const roster = [
    "## Admin team — individually",
    "",
    ...admins.map((a) => `• **${a.name}** (<@${a.id}>) — ${adminNotes(a.name)}`),
    "",
    "---",
    "",
    "_RootMC is better when the people holding the badge act like this. Proud to keep this team._",
  ].join("\n");

  return [intro, roster];
}

async function postMessage(content) {
  const res = await fetch(`${API}/channels/${CHANNEL_ID}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content: content.slice(0, 2000) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Discord ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function main() {
  console.log("Resolving Admin role members…");
  const admins = await fetchAdmins();
  if (admins.length === 0) {
    console.error("No Admin role members found.");
    process.exit(1);
  }
  console.log(`Found ${admins.length}: ${admins.map((a) => a.name).join(", ")}`);

  const parts = buildMessages(admins);
  if (DRY_RUN) {
    for (const p of parts) console.log("\n---\n" + p);
    return;
  }

  let last;
  for (const part of parts) {
    last = await postMessage(part);
    await sleep(700);
  }
  console.log(`Posted ${parts.length} message(s) → #admins`);
  console.log(`https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${last?.id || ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
