/**
 * Post RootMC Discord channel ID reference to Discord (legacy mirror).
 *
 * Canonical home is Slack:
 *   #discord-channels (C0BM4QT5U0Z)
 *   Canvas: https://rootmcworkspace.slack.com/docs/T0BM02SM1FE/F0BLMFYJYEB
 * Migrated from Discord #discord-ids (1520386796406706216).
 *
 * Usage:
 *   node scripts/post-rootmc-discord-channel-inventory.mjs
 *   node scripts/post-rootmc-discord-channel-inventory.mjs --channel 1520386796406706216 --pin
 */
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";
import { ROOTMC_SLACK_CANVASES } from "./lib/rootmc-slack-channels.mjs";

const API = "https://discord.com/api/v10";
const GUILD_ID = "1516108585740800042";
/** Legacy Discord mirror only — prefer Slack #discord-channels + canvas. */
const DEFAULT_CHANNEL = "1520386796406706216";

const channelArgIdx = process.argv.indexOf("--channel");
const POST_CHANNEL =
  channelArgIdx >= 0 ? String(process.argv[channelArgIdx + 1] || "").trim() : DEFAULT_CHANNEL;
const PIN_FIRST = process.argv.includes("--pin");

const env = loadRootMcEnv();
const token = rootMcBotToken(env);

if (!/^\d{10,}$/.test(POST_CHANNEL)) {
  console.error("Invalid --channel");
  process.exit(1);
}
if (token.length < 40) {
  console.error("Need DISCORD_ROOTMC_BOT_TOKEN");
  process.exit(1);
}

/** wrangler.toml + scripts — static channels & categories. */
const KNOWN = {
  "1545284354157187083": "Primary hub (#general-chat) — chat, link welcomes, weekly awards, proposal results",
  "1545284399107547179": "In-game ↔ Discord chat bridge",
  "1516828735536365669": "Legacy Discord in-game /feedback — migrated to Slack #feedback (C0BLMGBVAMD)",
  "1517360597686157605": "Category: /report ticket channels (staff + reporter)",
  "1516395175780286615": "#daily-summary — combined daily + weekly AI digest",
  "1516804780884889621": "#economy-guide — economy tutorial + daily/weekly economy briefs",
  "1516282373426249878": "Town info — daily/weekly towns briefs + founded/fallen posts",
  "1516283667364974602": "Nation info — daily/weekly nations briefs + founded/fallen posts",
  "1516143406315737169": "Operations forum — /proposal votes, appeals, server updates (daily AI reads)",
  "1516391754625187921": "Bot-spam + legacy app feedback (excluded from activity scoring)",
  "1516121832493678612": "#admins — staff coordination + MC↔Discord link notifications",
  "1516392367869919243": "Rules (read-only; post-rootmc-rules.mjs)",
  "1519249871326937138": "Unverified onboarding — verify before full access",
  "1516282271848726628": "DISABLED — former town private category (auto-create removed temporarily)",
  "1516283613283483749": "DISABLED — former nation private category (auto-create removed temporarily)",
  "1520366347194990682": "Staff/dev — automation + cron + API inventory posts",
  "1520369402795659304": "Staff — user activity / expected online times reports",
  "1520371322033668216": "Staff — auth actions / exile purge reports",
  "1520385893653938236": "Legacy Discord API reference — migrated to Slack #api-description (C0BM6HN0WMA) + canvas F0BLMFRPA8P",
  "1520386796406706216": "Legacy Discord channel ID list — migrated to Slack #discord-channels (C0BM4QT5U0Z) + canvas F0BLMFYJYEB",
  "1520387570004135956": "Legacy Discord cron inventory — migrated to Slack #crons-automation (C0BLMHKTCTH) + canvas F0BLZK9RHHT",
};

const TYPE_LABEL = { 0: "text", 2: "voice", 4: "category", 5: "announce", 13: "stage", 15: "forum" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function discordGet(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bot ${token}`, "User-Agent": "RootRecord/rootmc-channel-inventory" },
  });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    await sleep(Math.ceil((body.retry_after || 1) * 1000) + 300);
    return discordGet(path);
  }
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

function purposeFor(ch, categories) {
  if (KNOWN[ch.id]) return KNOWN[ch.id];
  const parent = categories.get(ch.parent_id || "");
  const parentName = parent?.name?.toLowerCase() || "";
  if (ch.parent_id === "1516282271848726628" || parentName.includes("town")) {
    return `Dynamic town channel **${ch.name}** — private Towny coordination`;
  }
  if (ch.parent_id === "1516283613283483749" || parentName.includes("nation")) {
    return `Dynamic nation channel **${ch.name}** — private nation coordination`;
  }
  if (ch.parent_id === "1517360597686157605" || parentName.includes("report")) {
    return `Report ticket **${ch.name}** — in-game /report (staff)`;
  }
  if (ch.type === 2 || ch.type === 13) return `Voice/stage — ${ch.topic || ch.name}`;
  if (ch.type === 4) return `Category — organizes ${ch.name} channels`;
  if (ch.type === 15) return `Forum — ${ch.topic || ch.name}`;
  return ch.topic || "General channel — no Worker mapping in wrangler.toml";
}

function chunkLines(lines, maxLen = 1900) {
  const out = [];
  let buf = "";
  for (const line of lines) {
    if ((buf + line + "\n").length > maxLen) {
      if (buf) out.push(buf.trimEnd());
      buf = line + "\n";
    } else {
      buf += line + "\n";
    }
  }
  if (buf.trim()) out.push(buf.trimEnd());
  return out.map((s) => s.slice(0, 2000));
}

async function main() {
  const guild = await discordGet(`/guilds/${GUILD_ID}?with_counts=true`);
  const channels = await discordGet(`/guilds/${GUILD_ID}/channels`);
  channels.sort(
    (a, b) =>
      String(a.parent_id || "").localeCompare(String(b.parent_id || "")) ||
      (a.position || 0) - (b.position || 0),
  );

  const categories = new Map(channels.filter((c) => c.type === 4).map((c) => [c.id, c]));
  const generated = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

  const header = `# RootMC Discord — channel IDs (pinned)

_Guild **${guild.name}** \`${GUILD_ID}\` · ~${guild.approximate_member_count ?? "?"} members · Generated ${generated}_

Canonical channel list for staff/dev. **Env var names** match \`Web/cloudflare/rootmc-api/wrangler.toml\` where wired.

**Legend:** \`id\` = snowflake · dynamic town/nation channels are created under their categories by cron.`;

  const staticLines = ["", "## Wired in Worker (wrangler.toml)", ""];
  for (const [id, purpose] of Object.entries(KNOWN).sort((a, b) => a[1].localeCompare(b[1]))) {
    staticLines.push(`• \`${id}\` — ${purpose}`);
  }

  const byCategory = new Map();
  for (const ch of channels) {
    if (ch.type === 4) continue;
    const parent = ch.parent_id ? categories.get(ch.parent_id) : null;
    const key = parent ? `${parent.name} (${parent.id})` : "(no category)";
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(ch);
  }

  const liveLines = ["", "## Live guild channels (snapshot)", ""];
  for (const [catName, list] of [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    liveLines.push(`**${catName}**`);
    for (const ch of list) {
      const type = TYPE_LABEL[ch.type] || `type-${ch.type}`;
      liveLines.push(
        `• #${ch.name} \`${ch.id}\` (${type}) — ${purposeFor(ch, categories)}`,
      );
    }
    liveLines.push("");
  }

  liveLines.push(
    `_Legacy Discord mirror. Canonical: Slack #discord-channels · ${ROOTMC_SLACK_CANVASES.discordChannelIds}_`,
    `_Re-run Discord mirror: \`node scripts/post-rootmc-discord-channel-inventory.mjs --channel ${POST_CHANNEL} --pin\`_`,
  );

  const parts = chunkLines([header, ...staticLines]).concat(chunkLines(liveLines));

  async function send(content) {
    const res = await fetch(`${API}/channels/${POST_CHANNEL}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 2000) }),
    });
    if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text().catch(() => "")}`);
    return res.json();
  }

  async function pin(messageId) {
    const res = await fetch(`${API}/channels/${POST_CHANNEL}/pins/${messageId}`, {
      method: "PUT",
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) throw new Error(`Pin ${res.status}`);
  }

  let first;
  let last;
  for (const part of parts) {
    const msg = await send(part);
    if (!first) first = msg;
    last = msg;
    await sleep(650);
  }

  if (PIN_FIRST && first?.id) {
    await pin(first.id);
    console.log(`Pinned ${first.id}`);
  }
  console.log(`Posted ${parts.length} message(s) → ${POST_CHANNEL}`);
  console.log(`https://discord.com/channels/${GUILD_ID}/${POST_CHANNEL}/${last?.id || ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
