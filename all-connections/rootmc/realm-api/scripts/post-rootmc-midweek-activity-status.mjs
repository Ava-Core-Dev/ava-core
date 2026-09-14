/**
 * Mid-week standings — Top Participator (Discord) + Top Active Player (in-game playtime).
 * Same scoring as Sunday awards; period = Mon 00:00 HST through now.
 *
 *   node scripts/post-rootmc-midweek-activity-status.mjs
 *   node scripts/post-rootmc-midweek-activity-status.mjs --dry-run
 *   node scripts/post-rootmc-midweek-activity-status.mjs --channel general
 */
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";
import { postDiscordMessageChunks, ROOTMC_CHANNELS, resolveRootMcChannel } from "./lib/rootmc-discord.mjs";
import { EXILED_DISCORD_IDS } from "./lib/rootmc-exiled-discord-ids.mjs";

const HST_OFFSET_MS = 10 * 60 * 60 * 1000;
const D1_DATABASE_ID = "6cf71128-67e3-47b2-a802-d6c23d6489e0";
const CF_ACCOUNT_ID = "f3372b30093435bacc35b69972abeb2e";
const SKIP_CHANNELS = new Set([
  "1516391754625187921", // bot-spam
  "1516395175780286615", // daily-summary
  "1545283818146242642", // raw AI archive
]);
const MIN_ACTIVITY_SCORE = 5;
const MIN_WEEKLY_SECONDS = 3600;
const TOP_N = 5;
const PREVIEW_N = 10;

const dryRun = process.argv.includes("--dry-run");
const channelArgIdx = process.argv.indexOf("--channel");
const channelKey = channelArgIdx >= 0 ? process.argv[channelArgIdx + 1] : "general";

const env = loadRootMcEnv();

function str(v) {
  return String(v ?? "").trim();
}

function cfToken() {
  return str(process.env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN);
}

async function d1Query(sql) {
  const cf = cfToken();
  if (cf.length < 20) throw new Error("CLOUDFLARE_API_TOKEN missing");
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${cf}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    },
  );
  const data = await res.json();
  if (!data.success) throw new Error(JSON.stringify(data.errors || data).slice(0, 500));
  return data.result?.[0]?.results || [];
}

function currentHstWeekKey(at = new Date()) {
  const hst = new Date(at.getTime() - HST_OFFSET_MS);
  const y = hst.getUTCFullYear();
  const m = hst.getUTCMonth();
  const d = hst.getUTCDate();
  const dow = hst.getUTCDay();
  const daysBack = dow === 0 ? 6 : dow - 1;
  const mon = new Date(Date.UTC(y, m, d - daysBack));
  return `${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, "0")}-${String(mon.getUTCDate()).padStart(2, "0")}`;
}

function previousHstWeekKey(weekKey) {
  const startMs = Date.parse(`${weekKey}T00:00:00-10:00`);
  const prevMon = new Date(startMs - 7 * 24 * 60 * 60 * 1000);
  return `${prevMon.getUTCFullYear()}-${String(prevMon.getUTCMonth() + 1).padStart(2, "0")}-${String(prevMon.getUTCDate()).padStart(2, "0")}`;
}

function hstWeekBoundsMs(weekKey) {
  const startMs = Date.parse(`${weekKey}T00:00:00-10:00`);
  const endMs = startMs + 7 * 24 * 60 * 60 * 1000 - 1;
  return { startMs, endMs };
}

function formatPlaytime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function mention(userId) {
  return `<@${userId}>`;
}

function formatParticipatorScore(w) {
  const votePts = w.vote_count * 5;
  return `**${w.activity_score}** pts (${w.message_blocks} blocks · ${w.vote_count} votes = ${votePts} pts · ${w.reaction_count} reactions)`;
}

function countMessageBlocksInChannel(ordered, userId) {
  let blocks = 0;
  let prevAuthor = null;
  for (const msg of ordered) {
    const author = str(msg.discord_user_id);
    if (author === userId && prevAuthor !== userId) blocks += 1;
    prevAuthor = author;
  }
  return blocks;
}

function hstLabel(ms) {
  return new Date(ms).toLocaleDateString("en-US", {
    timeZone: "Pacific/Honolulu",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function resolveServerId() {
  const rows = await d1Query(
    `SELECT server_id FROM rootstat_servers WHERE featured = 1 ORDER BY updated_at DESC LIMIT 1`,
  );
  return str(rows[0]?.server_id) || "rootmc";
}

async function fetchDiscordCandidates(startIso, endIso) {
  const skipList = [...SKIP_CHANNELS].map((id) => `'${id}'`).join(",");
  const msgRows = await d1Query(
    `SELECT discord_user_id, channel_id, created_at, username, global_name
     FROM discord_message_activity
     WHERE created_at >= '${startIso}' AND created_at <= '${endIso}'
       AND channel_id NOT IN (${skipList})
     ORDER BY channel_id ASC, created_at ASC`,
  );

  const byChannel = new Map();
  for (const r of msgRows) {
    const ch = str(r.channel_id);
    if (!ch) continue;
    const list = byChannel.get(ch) || [];
    list.push(r);
    byChannel.set(ch, list);
  }

  const perUser = new Map();
  for (const [channelId, msgs] of byChannel) {
    const userIds = new Set(msgs.map((m) => str(m.discord_user_id)).filter(Boolean));
    for (const uid of userIds) {
      if (EXILED_DISCORD_IDS.has(uid)) continue;
      const blocks = countMessageBlocksInChannel(msgs, uid);
      if (blocks <= 0) continue;
      const raw = msgs.filter((m) => str(m.discord_user_id) === uid).length;
      const sample = msgs.find((m) => str(m.discord_user_id) === uid);
      const display = str(sample?.global_name) || str(sample?.username) || uid;
      const cur = perUser.get(uid) || {
        display_name: display,
        message_blocks: 0,
        raw_message_count: 0,
        channels: new Set(),
      };
      cur.message_blocks += blocks;
      cur.raw_message_count += raw;
      cur.channels.add(channelId);
      if (!cur.display_name || cur.display_name === uid) cur.display_name = display;
      perUser.set(uid, cur);
    }
  }

  const voteRows = await d1Query(
    `SELECT discord_user_id, COUNT(*) AS vote_count
     FROM rootmc_community_proposal_votes
     WHERE voted_at >= '${startIso}' AND voted_at <= '${endIso}'
     GROUP BY discord_user_id`,
  );
  const votes = new Map();
  for (const r of voteRows) {
    const uid = str(r.discord_user_id);
    if (uid && !EXILED_DISCORD_IDS.has(uid)) votes.set(uid, Number(r.vote_count) || 0);
  }

  const reactRows = await d1Query(
    `SELECT discord_user_id,
            COALESCE(MAX(global_name), MAX(username), discord_user_id) AS display_name,
            COUNT(*) AS reaction_count
     FROM discord_reaction_activity
     WHERE created_at >= '${startIso}' AND created_at <= '${endIso}'
       AND channel_id NOT IN (${skipList})
     GROUP BY discord_user_id`,
  );
  const reactions = new Map();
  for (const r of reactRows) {
    const uid = str(r.discord_user_id);
    if (uid && !EXILED_DISCORD_IDS.has(uid)) {
      reactions.set(uid, {
        reaction_count: Number(r.reaction_count) || 0,
        display_name: str(r.display_name) || uid,
      });
    }
  }

  const userIds = new Set([...perUser.keys(), ...votes.keys(), ...reactions.keys()]);
  const merged = [];
  for (const uid of userIds) {
    const msg = perUser.get(uid);
    const voteCount = votes.get(uid) || 0;
    const react = reactions.get(uid);
    const messageBlocks = msg?.message_blocks || 0;
    const reactionCount = react?.reaction_count || 0;
    const activityScore = messageBlocks + voteCount * 5 + reactionCount;
    if (activityScore < MIN_ACTIVITY_SCORE) continue;
    merged.push({
      discord_user_id: uid,
      display_name: msg?.display_name || react?.display_name || uid,
      message_blocks: messageBlocks,
      vote_count: voteCount,
      reaction_count: reactionCount,
      activity_score: activityScore,
      channel_count: msg?.channels.size || 0,
    });
  }

  merged.sort((a, b) => {
    if (b.activity_score !== a.activity_score) return b.activity_score - a.activity_score;
    if (b.message_blocks !== a.message_blocks) return b.message_blocks - a.message_blocks;
    return a.discord_user_id.localeCompare(b.discord_user_id);
  });
  return merged;
}

async function fetchPlaytimeStandings(serverId, weekKey, prevWeekKey) {
  const exiled = [...EXILED_DISCORD_IDS].map((id) => `'${id}'`).join(",");
  const exClause = exiled.length ? `AND d.discord_user_id NOT IN (${exiled})` : "";
  const rows = await d1Query(
    `SELECT p.minecraft_uuid,
            COALESCE(p.minecraft_username, m.minecraft_username) AS minecraft_username,
            MAX(0, p.total_playtime_seconds - COALESCE(snap.total_playtime_seconds, 0)) AS weekly_seconds,
            d.discord_user_id,
            COALESCE(d.discord_global_name, d.discord_username, d.discord_user_id) AS discord_display_name
     FROM rootstat_player_playtime p
     INNER JOIN rootstat_minecraft_links m ON LOWER(m.minecraft_uuid) = LOWER(p.minecraft_uuid)
     INNER JOIN discord_account_links d ON d.account_id = m.account_id
     LEFT JOIN rootmc_playtime_week_snapshots snap
       ON snap.server_id = p.server_id
      AND snap.minecraft_uuid = LOWER(p.minecraft_uuid)
      AND snap.week_key = '${prevWeekKey}'
     WHERE p.server_id = '${serverId}'
       AND d.discord_user_id IS NOT NULL AND TRIM(d.discord_user_id) != ''
       ${exClause}
     GROUP BY p.minecraft_uuid
     HAVING weekly_seconds >= ${MIN_WEEKLY_SECONDS}
     ORDER BY weekly_seconds DESC, p.minecraft_uuid ASC
     LIMIT ${PREVIEW_N}`,
  );
  return rows.map((row, idx) => ({
    rank: idx + 1,
    minecraft_username: str(row.minecraft_username) || "Unknown",
    discord_user_id: str(row.discord_user_id),
    discord_display_name: str(row.discord_display_name) || str(row.discord_user_id),
    weekly_playtime_seconds: Math.max(0, Math.floor(Number(row.weekly_seconds) || 0)),
    weekly_playtime_label: formatPlaytime(row.weekly_seconds),
  }));
}

function buildReport(weekKey, startMs, nowMs, discordRows, playtimeRows, baselineWeekKey) {
  const startLabel = hstLabel(startMs);
  const nowLabel = hstLabel(nowMs);
  const dayName = new Date(nowMs).toLocaleDateString("en-US", {
    timeZone: "Pacific/Honolulu",
    weekday: "long",
  });

  const lines = [
    `# 📊 Mid-week activity standings — Week of ${weekKey}`,
    "",
    `**Snapshot:** ${dayName}, ${nowLabel} **HST** · Period **${startLabel} – now** (Mon–Sun week).`,
    "_Not final — roles post **Sunday 10:00 HST** after Root-AI review (Discord) and playtime snapshots._",
    "",
    "## 💬 Top Participator (Discord) — current pace",
    "",
    "**How we measure it**",
    "• **Message blocks** — 1 pt each (consecutive posts until someone else speaks)",
    "• **Votes** — 5 pts each (`/proposal`)",
    "• **Reactions** — 1 pt each",
    "• Sunday: Root-AI excludes spam before final **top 5** + role",
    `• Minimum **${MIN_ACTIVITY_SCORE} weighted points** to appear below`,
    "",
  ];

  if (discordRows.length === 0) {
    lines.push("_No qualifying Discord activity yet this week._");
  } else {
    discordRows.slice(0, PREVIEW_N).forEach((w, i) => {
      const marker = i < TOP_N ? "🏅" : "▫️";
      lines.push(`${marker} ${i + 1}. ${mention(w.discord_user_id)} (**${w.display_name}**) — ${formatParticipatorScore(w)}`);
    });
    if (discordRows.length > PREVIEW_N) {
      lines.push(`_+${discordRows.length - PREVIEW_N} more above minimum score._`);
    }
    lines.push("", `_Top **${TOP_N}** on Sunday earn <@&1518311748627726346>._`);
  }

  lines.push("", "## ⛏ Top Active Players (In-game) — current pace", "", "**How we measure it**");
  lines.push(
    "• **Playtime this week** — live total minus prior-Sunday snapshot (linked accounts only)",
    `• Minimum **${Math.floor(MIN_WEEKLY_SECONDS / 3600)} hour** this week to rank · **top ${TOP_N}** earn role + **one-week Pro** Sunday`,
    "• Link at https://rootmc.net/verify if you are not on the board",
    "",
  );

  if (playtimeRows.length === 0) {
    lines.push(
      `_No linked players at **${Math.floor(MIN_WEEKLY_SECONDS / 3600)}h+** yet — or baseline snapshot (\`${baselineWeekKey}\`) missing._`,
    );
  } else {
    playtimeRows.forEach((w) => {
      const marker = w.rank <= TOP_N ? "🏅" : "▫️";
      lines.push(
        `${marker} ${w.rank}. ${mention(w.discord_user_id)} (**${w.minecraft_username}**) — **${w.weekly_playtime_label}** in-game`,
      );
    });
    lines.push("", `_Top **${TOP_N}** on Sunday earn <@&1518320460729679922> + Pro membership._`);
  }

  lines.push(
    "",
    "_Discord: message blocks + votes + reactions in D1. In-game: RootStat playtime vs weekly snapshot._",
    "_Full rules: https://rootmc.net/wiki/weekly-awards/_",
  );

  return lines.join("\n");
}

async function main() {
  const weekKey = currentHstWeekKey();
  const prevWeekKey = previousHstWeekKey(weekKey);
  const { startMs } = hstWeekBoundsMs(weekKey);
  const nowMs = Date.now();
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(nowMs).toISOString();

  console.log("Week", weekKey, "through", endIso);

  const serverId = await resolveServerId();
  if (!serverId) throw new Error("featured server id not found");

  const [discordRows, playtimeRows] = await Promise.all([
    fetchDiscordCandidates(startIso, endIso),
    fetchPlaytimeStandings(serverId, weekKey, prevWeekKey),
  ]);

  const body = buildReport(weekKey, startMs, nowMs, discordRows, playtimeRows, prevWeekKey);

  if (dryRun) {
    console.log(body);
    return;
  }

  const channelId = resolveRootMcChannel(channelKey);
  const posted = await postDiscordMessageChunks({
    channelId,
    content: body,
    token: rootMcBotToken(env),
    userAgent: "RootMC/post-rootmc-midweek-activity-status",
  });
  console.log("posted", posted[0]?.id);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
