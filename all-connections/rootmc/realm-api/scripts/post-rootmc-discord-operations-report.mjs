/**
 * Live scan of every RootMC Discord channel → detailed operations report.
 *
 * Usage:
 *   node scripts/post-rootmc-discord-operations-report.mjs
 *   node scripts/post-rootmc-discord-operations-report.mjs --channel 1545284354157187083
 *   node scripts/post-rootmc-discord-operations-report.mjs --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";
import { isExiledDiscordUser, EXILED_DISCORD_IDS } from "./lib/rootmc-exiled-discord-ids.mjs";

const API = "https://discord.com/api/v10";
const GUILD_ID = "1516108585740800042";
const DEFAULT_POST_CHANNEL = "1545284354157187083";

const channelArgIdx = process.argv.indexOf("--channel");
const POST_CHANNEL =
  channelArgIdx >= 0
    ? String(process.argv[channelArgIdx + 1] || "").trim()
    : DEFAULT_POST_CHANNEL;
const DRY_RUN = process.argv.includes("--dry-run");

const env = loadRootMcEnv();
const token = rootMcBotToken(env);

if (!/^\d{10,}$/.test(POST_CHANNEL)) {
  console.error("Invalid --channel id");
  process.exit(1);
}
if (token.length < 40) {
  console.error("Need DISCORD_ROOTMC_BOT_TOKEN");
  process.exit(1);
}

const CHANNEL_TYPE = {
  0: "text",
  2: "voice",
  4: "category",
  5: "announcement",
  13: "stage",
  15: "forum",
};

/** Known automation wiring (MonoRepo source of truth). */
const KNOWN = {
  "1545284354157187083": {
    key: "DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID",
    purpose: "Primary community hub — player chat, onboarding, link welcomes, weekly award announcements, closed proposal pings, season-arc starts.",
    automation: "READ (daily AI digest) · WRITE (link welcome, awards, proposals, seasons) · SCORED (activity awards)",
    usability: "High — default landing channel for linked players. Keep readable; bot posts should stay concise.",
  },
  "1545284399107547179": {
    key: "DISCORD_ROOTMC_INGAME_CHAT_CHANNEL_ID",
    purpose: "Bidirectional in-game ↔ Discord chat bridge (RootMC plugin polls/post).",
    automation: "WRITE (MC→Discord) · READ (Discord→MC poll every few seconds in-game)",
    usability: "Functional — volume scales with online players. Humans + mirrored MC chat; avoid heavy bot spam here.",
  },
  "1516828735536365669": {
    key: "DISCORD_ROOTMC_INGAME_FEEDBACK_CHANNEL_ID (legacy)",
    purpose: "LEGACY Discord intake — live /feedback now posts to Slack #feedback (C0BLMGBVAMD) via SLACK_FEEDBACK_WEBHOOK_URL.",
    automation: "NONE (migrated) — Worker posts Slack Incoming Webhook",
    usability: "Do not use for new staff review — use Slack #feedback.",
  },
  "1517360597686157605": {
    key: "DISCORD_ROOTMC_REPORT_TICKETS_CATEGORY_ID",
    purpose: "Private report ticket channels/threads created from in-game /report (Root-Admin).",
    automation: "WRITE (ingame-report API creates channels) · staff-only visibility",
    usability: "Critical moderation path — each ticket is ephemeral channel under this category.",
  },
  "1516395175780286615": {
    key: "DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID",
    purpose: "Daily + weekly combined Grok intelligence summary for the whole server.",
    automation: "WRITE (cron daily 00:00 HST, weekly Sun) · EXCLUDED from activity scoring",
    usability: "Read-only digest — players subscribe by reading; don't expect conversation here.",
  },
  "1516804780884889621": {
    key: "DISCORD_ROOTMC_ECONOMY_ANNOUNCE_CHANNEL_ID",
    purpose: "Economy guide, tutorial posts, daily/weekly economy_intel AI briefs.",
    automation: "WRITE (cron category reports, economy tutorial script)",
    usability: "Reference channel — good for market/treasury context; pair with wiki + /value bot command.",
  },
  "1516282373426249878": {
    key: "DISCORD_ROOTMC_TOWN_INFO_CHANNEL_ID",
    purpose: "Towny meta: daily/weekly towns briefs + founded/fallen town announcements.",
    automation: "WRITE (cron + towny sync plugin)",
    usability: "Info feed for town mayors and recruits — low conversational expectation.",
  },
  "1516283667364974602": {
    key: "DISCORD_ROOTMC_NATION_INFO_CHANNEL_ID",
    purpose: "Nation meta: daily/weekly nations briefs + founded/fallen nation announcements.",
    automation: "WRITE (cron + towny sync plugin)",
    usability: "Same pattern as town info — nation leaders + diplomacy audience.",
  },
  "1516143406315737169": {
    key: "DISCORD_ROOTMC_OPERATIONS_FORUM_CHANNEL_ID",
    purpose: "Operations forum — community proposals (vote threads), appeals, server-update discussion.",
    automation: "READ (daily ops digest) · WRITE (/proposal create threads, vote embeds)",
    usability: "Structured governance — thread-per-topic; linked MC account required to vote.",
  },
  "1516391754625187921": {
    key: "DISCORD_FEEDBACK_CHANNEL_ID / BOT_SPAM",
    purpose: "Legacy app feedback embeds + bot diagnostic spam.",
    automation: "WRITE (POST /api/feedback) · EXCLUDED from activity scoring",
    usability: "Low for humans — mostly bot output; consider routing app feedback elsewhere long-term.",
  },
  "1516121832493678612": {
    key: "DISCORD_ROOTMC_ADMINS_CHANNEL_ID",
    purpose: "Staff/admin coordination; MC↔Discord link notifications with account details.",
    automation: "WRITE (link complete notify) · permission locked",
    usability: "Staff only — sensitive link metadata; not player-facing.",
  },
  "1511922772983545947": {
    key: "DISCORD_ROOTMC_AI_ARCHIVE_CHANNEL_ID",
    purpose: "Archive of successful in-game world AI reports (BlockNotes / world-ai API).",
    automation: "WRITE (world-ai on success)",
    usability: "Optional reading — pro/lifetime feature output mirror.",
  },
  "1516392367869919243": {
    key: "DISCORD_ROOTMC_RULES_CHANNEL_ID",
    purpose: "Server rules (posted via post-rootmc-rules.mjs); read-only for members.",
    automation: "Manual script · guild perm sync read-only",
    usability: "Onboarding — link from verify flow and unverified channel.",
  },
  "1519249871326937138": {
    key: "DISCORD_ROOTMC_UNVERIFIED_CHANNEL_ID",
    purpose: "Pre-link onboarding — verify instructions before full guild access.",
    automation: "Manual script post-rootmc-unverified-guide.mjs",
    usability: "Gate channel — should funnel to rootmc.net/verify quickly.",
  },
  "1516282271848726628": {
    key: "DISCORD_ROOTMC_TOWN_CATEGORY_ID",
    purpose: "DISABLED — private per-town Discord channels (category removed from guild).",
    automation: "NONE (reconcile cron + towny sync create/delete/DM off)",
    usability: "Do not recreate until categories return and wrangler IDs are restored.",
  },
  "1516283613283483749": {
    key: "DISCORD_ROOTMC_NATION_CATEGORY_ID",
    purpose: "DISABLED — private per-nation Discord channels (category removed from guild).",
    automation: "NONE (reconcile cron + towny sync create/delete/DM off)",
    usability: "Do not recreate until categories return and wrangler IDs are restored.",
  },
  "1520366347194990682": {
    key: "(admin inventory)",
    purpose: "Internal automation/cron/API inventory posts from dev scripts.",
    automation: "WRITE (post-*-inventory.mjs scripts)",
    usability: "Staff/dev reference — not player-facing.",
  },
};

const CATEGORY_HINT = {
  "1516282271848726628": "town-private",
  "1516283613283483749": "nation-private",
  "1517360597686157605": "report-ticket",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function discordGet(path) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bot ${token}`,
      "User-Agent": "RootRecord/rootmc-ops-report",
    },
  });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    const wait = Math.ceil((body.retry_after || 1) * 1000) + 200;
    await sleep(wait);
    return discordGet(path);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} → ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchMessages(channelId, maxPages = 2) {
  const all = [];
  let before = "";
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ limit: "100" });
    if (before) qs.set("before", before);
    try {
      const batch = await discordGet(`/channels/${channelId}/messages?${qs}`);
      if (!Array.isArray(batch) || batch.length === 0) break;
      all.push(...batch);
      before = batch[batch.length - 1]?.id || "";
      if (batch.length < 100) break;
      await sleep(350);
    } catch (e) {
      if (String(e.message).includes("403") || String(e.message).includes("404")) break;
      throw e;
    }
  }
  return all;
}

async function fetchForumThreads(channelId) {
  try {
    const active = await discordGet(`/channels/${channelId}/threads/active`);
    const archived = await discordGet(`/channels/${channelId}/threads/archived/public?limit=50`);
    return {
      active: active?.threads || [],
      archived: archived?.threads || [],
    };
  } catch {
    return { active: [], archived: [] };
  }
}

function analyzeMessages(msgs) {
  const humans = new Set();
  const bots = new Set();
  let humanCount = 0;
  let botCount = 0;
  let oldest = null;
  let newest = null;
  for (const m of msgs) {
    const ts = m.timestamp ? Date.parse(m.timestamp) : NaN;
    if (Number.isFinite(ts)) {
      if (oldest == null || ts < oldest) oldest = ts;
      if (newest == null || ts > newest) newest = ts;
    }
    const id = String(m.author?.id || "");
    if (!id) continue;
    if (m.author?.bot) {
      botCount++;
      bots.add(id);
    } else if (isExiledDiscordUser(id)) {
      continue;
    } else {
      humanCount++;
      humans.add(id);
    }
  }
  const spanDays =
    oldest != null && newest != null && newest > oldest
      ? Math.max(0.25, (newest - oldest) / 86400000)
      : null;
  const humanPerDay = spanDays && humanCount ? Math.round((humanCount / spanDays) * 10) / 10 : null;
  let tier = "INACTIVE";
  if (humanCount === 0 && botCount > 0) tier = "BOT_ONLY";
  else if (humanCount >= 40 || (humanPerDay != null && humanPerDay >= 8)) tier = "HIGH";
  else if (humanCount >= 10 || (humanPerDay != null && humanPerDay >= 2)) tier = "MEDIUM";
  else if (humanCount > 0) tier = "LOW";
  return {
    sampled: msgs.length,
    humanCount,
    botCount,
    uniqueHumans: humans.size,
    uniqueBots: bots.size,
    oldest: oldest ? new Date(oldest).toISOString().slice(0, 10) : "—",
    newest: newest ? new Date(newest).toISOString().slice(0, 10) : "—",
    humanPerDay,
    tier,
  };
}

function inferPurpose(ch, categories) {
  const id = ch.id;
  if (KNOWN[id]) return KNOWN[id];
  const parent = categories.get(ch.parent_id || "");
  const parentName = parent?.name?.toLowerCase() || "";
  const name = (ch.name || "").toLowerCase();
  const hint = CATEGORY_HINT[ch.parent_id || ""];

  if (hint === "town-private" || parentName.includes("town")) {
    return {
      key: "dynamic town channel",
      purpose: `Private coordination for Towny town **${ch.name}** (auto-provisioned).`,
      automation: "CREATE/PATCH/DELETE via towny reconcile cron; mayor gets DM invite.",
      usability: "Town members only — keep invite links fresh; archive on town delete.",
    };
  }
  if (hint === "nation-private" || parentName.includes("nation")) {
    return {
      key: "dynamic nation channel",
      purpose: `Private coordination for nation **${ch.name}** (auto-provisioned).`,
      automation: "CREATE/PATCH/DELETE via towny reconcile cron; leader gets DM invite.",
      usability: "Nation members — same lifecycle as town channels.",
    };
  }
  if (hint === "report-ticket" || parentName.includes("report")) {
    return {
      key: "report ticket",
      purpose: `Moderation ticket channel **${ch.name}** from in-game /report.`,
      automation: "Created by ingame-report API; staff role access.",
      usability: "Staff + reporter — resolve in-thread then channel can be deleted.",
    };
  }
  if (ch.type === 2 || ch.type === 13) {
    return {
      key: "voice/stage",
      purpose: ch.topic || `Voice/stage room: ${ch.name}`,
      automation: "None automated",
      usability: "Real-time voice — activity not measured via messages.",
    };
  }
  if (ch.type === 4) {
    return {
      key: "category",
      purpose: `Organizes ${name} channels.`,
      automation: ch.id in CATEGORY_HINT ? KNOWN[ch.id]?.automation || "Container for automated channels" : "None",
      usability: "Structural — permissions inherit to children.",
    };
  }
  return {
    key: "unmapped",
    purpose: ch.topic || `General ${CHANNEL_TYPE[ch.type] || "channel"} — no hardcoded Worker mapping.`,
    automation: "None in wrangler.toml — verify manual use.",
    usability: "Review whether this channel still serves a clear player or staff function.",
  };
}

function chunkDiscordMessages(parts) {
  const out = [];
  let buf = "";
  for (const part of parts) {
    if ((buf + part).length > 1900) {
      if (buf) out.push(buf);
      buf = part;
    } else {
      buf += part;
    }
  }
  if (buf) out.push(buf);
  return out.map((c) => c.slice(0, 2000));
}

function formatChannelBlock(ch, meta, act, categories) {
  const type = CHANNEL_TYPE[ch.type] || `type-${ch.type}`;
  const parent = ch.parent_id ? categories.get(ch.parent_id)?.name : null;
  const lines = [
    `### #${ch.name} (\`${ch.id}\`)`,
    `**Type:** ${type}${parent ? ` · **Category:** ${parent}` : ""}`,
    `**Purpose:** ${meta.purpose}`,
    `**Automation:** ${meta.automation}`,
    `**Activity (sample):** tier **${act.tier}** — ${act.humanCount} human / ${act.botCount} bot msgs (${act.sampled} sampled), ${act.uniqueHumans} unique humans, ~${act.humanPerDay ?? "—"} human msgs/day, span ${act.oldest} → ${act.newest}`,
    `**Usability:** ${meta.usability}`,
    "",
  ];
  if (ch.type === 15 && (act.forumActive != null || act.forumArchived != null)) {
    lines.splice(
      5,
      0,
      `**Forum threads:** ${act.forumActive} active · ${act.forumArchived} archived (public sample)`,
    );
  }
  return lines.join("\n");
}

async function main() {
  console.log("Fetching guild…");
  const guild = await discordGet(`/guilds/${GUILD_ID}?with_counts=true`);
  const channels = await discordGet(`/guilds/${GUILD_ID}/channels`);
  channels.sort((a, b) => (a.parent_id || "").localeCompare(b.parent_id || "") || (a.position || 0) - (b.position || 0));

  const categories = new Map(channels.filter((c) => c.type === 4).map((c) => [c.id, c]));
  const scannable = channels.filter((c) => [0, 5, 15].includes(c.type));

  console.log(`Scanning ${scannable.length} message channels…`);
  const activityById = new Map();
  for (let i = 0; i < scannable.length; i++) {
    const ch = scannable[i];
    process.stdout.write(`  [${i + 1}/${scannable.length}] #${ch.name}\r`);
    const msgs = await fetchMessages(ch.id, ch.type === 15 ? 1 : 2);
    const act = analyzeMessages(msgs);
    if (ch.type === 15) {
      const threads = await fetchForumThreads(ch.id);
      act.forumActive = threads.active.length;
      act.forumArchived = threads.archived.length;
      await sleep(300);
    }
    activityById.set(ch.id, act);
    await sleep(400);
  }
  console.log("\nBuilding report…");

  const tierCounts = { HIGH: 0, MEDIUM: 0, LOW: 0, BOT_ONLY: 0, INACTIVE: 0 };
  for (const act of activityById.values()) tierCounts[act.tier] = (tierCounts[act.tier] || 0) + 1;

  const topHuman = [...scannable]
    .map((c) => ({ ch: c, act: activityById.get(c.id) }))
    .sort((a, b) => b.act.humanCount - a.act.humanCount)
    .slice(0, 8);

  const generated = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const parts = [];

  parts.push(`# RootMC Discord — Full Operations Report
_Guild **${guild.name}** (\`${GUILD_ID}\`) · Generated ${generated}_
_Live channel scan + MonoRepo automation map (\`rootmc-api\`, plugins, bot interactions)._

## Executive summary
• **Members:** ~${guild.approximate_member_count ?? "?"} (≈${guild.approximate_presence_count ?? "?"} online now)
• **Channels total:** ${channels.length} (${categories.size} categories · ${scannable.length} text/announcement/forum)
• **Activity tiers** (from last ≤200 msgs/channel): HIGH ${tierCounts.HIGH} · MEDIUM ${tierCounts.MEDIUM} · LOW ${tierCounts.LOW} · BOT_ONLY ${tierCounts.BOT_ONLY} · INACTIVE ${tierCounts.INACTIVE}
• **Exiled accounts:** ${EXILED_DISCORD_IDS.size} permanently excluded from human activity counts

## Discord operations stack
**Worker:** \`rootmc-api\` @ api.rootmc.net · **Bot app:** RootMC Discord (\`1511794429986345020\`)
**Crons:** */10 town/nation reconcile + activity ingest · daily 00:00 HST AI reports · Sun 08:00 HST weekly awards/reports · monthly dividend (no Discord)
**Interactions:** POST \`/v1/discord/rootmc/interactions\` — \`/help\` \`/server\` \`/value\` \`/balance\` \`/pay\` \`/proposal\` \`/systemreport\` + vote buttons + timezone roles
**In-game pipes:** chat bridge · feedback · reports · towny sync → see channel sections below

## Highest human activity (sample)
${topHuman.map(({ ch, act }, i) => `${i + 1}. **#${ch.name}** — ${act.humanCount} human msgs, ${act.uniqueHumans} users, ~${act.humanPerDay ?? "—"}/day`).join("\n")}

---

`);

  // Group channels by category for readable report
  const byParent = new Map();
  for (const ch of channels) {
    const pid = ch.parent_id || "_root";
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(ch);
  }

  const rootChannels = byParent.get("_root") || [];
  if (rootChannels.length) {
    parts.push(`## Channels outside categories\n`);
    for (const ch of rootChannels.sort((a, b) => (a.position || 0) - (b.position || 0))) {
      const meta = inferPurpose(ch, categories);
      const act = activityById.get(ch.id) || analyzeMessages([]);
      parts.push(formatChannelBlock(ch, meta, act, categories));
    }
  }

  for (const cat of [...categories.values()].sort((a, b) => (a.position || 0) - (b.position || 0))) {
    const kids = (byParent.get(cat.id) || []).sort((a, b) => (a.position || 0) - (b.position || 0));
    const catMeta = inferPurpose(cat, categories);
    parts.push(`## Category: ${cat.name} (\`${cat.id}\`)
**Purpose:** ${catMeta.purpose}
**Automation:** ${catMeta.automation}
**Child channels:** ${kids.length}

`);
    for (const ch of kids) {
      const meta = inferPurpose(ch, categories);
      const act = activityById.get(ch.id) || analyzeMessages([]);
      parts.push(formatChannelBlock(ch, meta, act, categories));
    }
  }

  parts.push(`## Activity scoring notes
• **Included** in weekly Top Participator ingest (*/10 cron): human messages + reactions in most text channels
• **Excluded:** bot-spam \`1516391754625187921\`, daily summary \`1516395175780286615\`, raw AI archive \`1545283818146242642\` (if present)
• **Awards posted to:** #general-chat — roles Top Participator + Top Active Player (Sun 08:00 HST)

## Usability recommendations
1. **#general-chat** — keep bot posts short; player conversation is the product
2. **In-game chat bridge** — high throughput; moderate MC poll rate if Discord is quiet
3. **Bot-spam / feedback** — split app feedback from diagnostics when possible
4. **Town/nation dynamic channels** — archive/delete on fall; DMs must reach mayors/leaders
5. **Operations forum** — primary governance surface; pin verify + /proposal help
6. **Report tickets** — staff SLA; close/delete resolved ticket channels
7. **AI digest channels** — read-only; point players to economy + daily summary for meta

_Re-run: \`node scripts/post-rootmc-discord-operations-report.mjs --channel ${POST_CHANNEL}\` · \`--dry-run\` writes \`ops-report.txt\`_`);

  const messages = chunkDiscordMessages(parts);
  console.log(`Report: ${messages.length} Discord message(s), ~${parts.join("").length} chars`);

  if (DRY_RUN) {
    const outPath = path.join(process.cwd(), "scripts", "ops-report.txt");
    fs.writeFileSync(outPath, parts.join(""), "utf8");
    console.log(`Dry run → ${outPath}`);
    return;
  }

  let last;
  for (let i = 0; i < messages.length; i++) {
    const res = await fetch(`${API}/channels/${POST_CHANNEL}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: messages[i] }),
    });
    if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text().catch(() => "")}`);
    last = await res.json();
    console.log(`Posted ${i + 1}/${messages.length}`);
    await sleep(700);
  }
  console.log(`Done → https://discord.com/channels/${GUILD_ID}/${POST_CHANNEL}/${last?.id || ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
