/**
 * User activity windows report — message timestamps + TZ roles → expected online times.
 *
 * Usage:
 *   node scripts/post-rootmc-user-activity-report.mjs
 *   node scripts/post-rootmc-user-activity-report.mjs --channel 1520369402795659304
 *   node scripts/post-rootmc-user-activity-report.mjs --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";
import { reportExclusionSet } from "./lib/rootmc-exiled-discord-ids.mjs";

const API = "https://discord.com/api/v10";
const GUILD_ID = "1516108585740800042";
const DEFAULT_CHANNEL = "1520369402795659304";
const EXCLUDED_CHANNELS = new Set([
  "1516391754625187921", // bot-spam
  "1516395175780286615", // daily-summary (bot digest)
  "1545283818146242642", // raw AI archive (off-guild)
]);
const MAX_PAGES = 12; // up to 1200 msgs / channel
const MAX_AGE_DAYS = 90;
const MIN_MSGS_FOR_USER = 3;
const SESSION_GAP_MS = 45 * 60 * 1000;

const channelArgIdx = process.argv.indexOf("--channel");
const POST_CHANNEL =
  channelArgIdx >= 0 ? String(process.argv[channelArgIdx + 1] || "").trim() : DEFAULT_CHANNEL;
const DRY_RUN = process.argv.includes("--dry-run");

const excludeArgIdx = process.argv.indexOf("--exclude-ids");
const extraExcludeIds =
  excludeArgIdx >= 0
    ? String(process.argv[excludeArgIdx + 1] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
/** Permanent exiles + optional CLI extras — never counted in reports. */
const EXCLUDE_IDS = reportExclusionSet(extraExcludeIds);

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

/** Mirrors discord-rootmc-bot.ts TIMEZONE_DEFS role names. */
const TZ_ROLE_PREFIX = "TZ UTC";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function discordGet(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bot ${token}`, "User-Agent": "RootRecord/rootmc-user-activity" },
  });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    await sleep(Math.ceil((body.retry_after || 1) * 1000) + 250);
    return discordGet(path);
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} → ${res.status} ${text.slice(0, 180)}`);
  }
  return res.json();
}

function parseTzOffsetFromRoleName(name) {
  const m = String(name || "").match(/TZ UTC([+-]\d{1,2})/i);
  if (!m) return null;
  return Number(m[1]);
}

function parseTzLabelFromRoleName(name) {
  return String(name || "").replace(/^TZ\s+/i, "").trim() || "Unknown";
}

function localHour(isoUtc, offsetHours) {
  const d = new Date(isoUtc);
  const utcH = d.getUTCHours() + d.getUTCMinutes() / 60;
  return ((Math.floor(utcH + offsetHours) % 24) + 24) % 24;
}

function localDow(isoUtc, offsetHours) {
  const d = new Date(isoUtc);
  const shifted = new Date(d.getTime() + offsetHours * 3600000);
  return shifted.getUTCDay(); // 0=Sun after shift approx
}

function fmtHour(h) {
  const hh = Math.floor(h);
  const mm = h - hh >= 0.5 ? "30" : "00";
  const ap = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  return `${h12}:${mm} ${ap}`;
}

function fmtHourRange(startH, endH) {
  return `${fmtHour(startH)}–${fmtHour(endH)}`;
}

/** Merge hours with counts into contiguous windows (local time). */
function activeWindows(hourCounts, thresholdPct = 0.08) {
  const total = hourCounts.reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  const minCount = Math.max(1, Math.ceil(total * thresholdPct));
  const active = hourCounts.map((c, h) => (c >= minCount ? h : -1)).filter((h) => h >= 0);
  if (active.length === 0) {
    const peak = hourCounts.indexOf(Math.max(...hourCounts));
    return [{ start: peak, end: (peak + 1) % 24 }];
  }
  active.sort((a, b) => a - b);
  const windows = [];
  let start = active[0];
  let prev = active[0];
  for (let i = 1; i < active.length; i++) {
    if (active[i] === prev + 1) {
      prev = active[i];
      continue;
    }
    windows.push({ start, end: prev + 1 });
    start = active[i];
    prev = active[i];
  }
  windows.push({ start, end: prev + 1 });
  return windows;
}

function sessionsFromTimestamps(timestamps) {
  if (!timestamps.length) return [];
  const sorted = [...timestamps].sort((a, b) => a - b);
  const sessions = [];
  let sessStart = sorted[0];
  let sessEnd = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sessEnd > SESSION_GAP_MS) {
      sessions.push({ start: sessStart, end: sessEnd });
      sessStart = sorted[i];
    }
    sessEnd = sorted[i];
  }
  sessions.push({ start: sessStart, end: sessEnd });
  return sessions;
}

function avgSessionStartHour(sessions, offsetHours) {
  if (!sessions.length) return null;
  const hrs = sessions.map((s) => localHour(new Date(s.start).toISOString(), offsetHours));
  return hrs.reduce((a, b) => a + b, 0) / hrs.length;
}

async function fetchChannelMessages(channelId) {
  const all = [];
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  let before = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ limit: "100" });
    if (before) qs.set("before", before);
    let batch;
    try {
      batch = await discordGet(`/channels/${channelId}/messages?${qs}`);
    } catch (e) {
      if (String(e.message).includes("403")) break;
      throw e;
    }
    if (!Array.isArray(batch) || batch.length === 0) break;
    let hitCutoff = false;
    for (const m of batch) {
      const ts = m.timestamp ? Date.parse(m.timestamp) : 0;
      if (ts && ts < cutoff) {
        hitCutoff = true;
        break;
      }
      all.push(m);
    }
    before = batch[batch.length - 1]?.id || "";
    if (hitCutoff || batch.length < 100) break;
    await sleep(320);
  }
  return all;
}

async function fetchMember(userId) {
  return discordGet(`/guilds/${GUILD_ID}/members/${userId}`);
}

function displayName(member, fallback) {
  const u = member?.user;
  if (!u) return fallback;
  return u.global_name || u.display_name || u.username || fallback;
}

function resolveUserTz(member, roleOffsetById) {
  const roleIds = member?.roles || [];
  for (const rid of roleIds) {
    const off = roleOffsetById.get(rid);
    if (off != null) return off;
  }
  return null;
}

function resolveUserTzLabel(member, roleLabelById) {
  for (const rid of member?.roles || []) {
    const label = roleLabelById.get(rid);
    if (label) return label;
  }
  return "Not set (using UTC for charts)";
}

function chunkMessages(parts) {
  const out = [];
  let buf = "";
  for (const p of parts) {
    if ((buf + p).length > 1900) {
      if (buf) out.push(buf);
      buf = p;
    } else buf += p;
  }
  if (buf) out.push(buf);
  return out.map((s) => s.slice(0, 2000));
}

async function main() {
  console.log("Loading guild channels & roles…");
  const [channels, roles] = await Promise.all([
    discordGet(`/guilds/${GUILD_ID}/channels`),
    discordGet(`/guilds/${GUILD_ID}/roles`),
  ]);

  const roleOffsetById = new Map();
  const roleLabelById = new Map();
  for (const r of roles || []) {
    if (String(r.name || "").startsWith(TZ_ROLE_PREFIX)) {
      const off = parseTzOffsetFromRoleName(r.name);
      if (off != null) {
        roleOffsetById.set(r.id, off);
        roleLabelById.set(r.id, parseTzLabelFromRoleName(r.name));
      }
    }
  }

  const textChannels = (channels || []).filter(
    (c) => [0, 5, 15].includes(c.type) && !EXCLUDED_CHANNELS.has(c.id),
  );

  console.log(`Scanning ${textChannels.length} channels (up to ${MAX_PAGES * 100} msgs each, ${MAX_AGE_DAYS}d window)…`);
  const userEvents = new Map(); // id -> { name, timestamps[] }

  for (let i = 0; i < textChannels.length; i++) {
    const ch = textChannels[i];
    process.stdout.write(`  [${i + 1}/${textChannels.length}] #${ch.name}          \r`);
    const msgs = await fetchChannelMessages(ch.id);
    for (const m of msgs) {
      if (m.author?.bot) continue;
      const id = String(m.author?.id || "");
      if (EXCLUDE_IDS.has(id)) continue;
      const ts = m.timestamp ? Date.parse(m.timestamp) : 0;
      if (!id || !ts) continue;
      if (!userEvents.has(id)) {
        userEvents.set(id, {
          name: m.author.global_name || m.author.username || id,
          timestamps: [],
        });
      }
      const row = userEvents.get(id);
      row.timestamps.push(ts);
      row.name = m.author.global_name || m.author.username || row.name;
    }
    await sleep(350);
  }
  console.log(`\nCollected activity for ${userEvents.size} users. Fetching member TZ roles…`);

  let users = [];
  const entries = [...userEvents.entries()].filter(([, v]) => v.timestamps.length >= MIN_MSGS_FOR_USER);
  entries.sort((a, b) => b[1].timestamps.length - a[1].timestamps.length);

  for (let i = 0; i < entries.length; i++) {
    const [uid, data] = entries[i];
    if (i % 10 === 0) process.stdout.write(`  members ${i}/${entries.length}\r`);
    const member = await fetchMember(uid);
    await sleep(180);
    const tzOffset = member ? resolveUserTz(member, roleOffsetById) : null;
    const tzLabel = member ? resolveUserTzLabel(member, roleLabelById) : "Not set";
    const offset = tzOffset ?? 0;
    const hourCounts = Array(24).fill(0);
    const dowCounts = Array(7).fill(0);
    for (const ts of data.timestamps) {
      const iso = new Date(ts).toISOString();
      hourCounts[Math.floor(localHour(iso, offset))]++;
      dowCounts[localDow(iso, offset)]++;
    }
    const sessions = sessionsFromTimestamps(data.timestamps);
    const windows = activeWindows(hourCounts);
    const avgStart = avgSessionStartHour(sessions, offset);
    const spanDays =
      data.timestamps.length > 1
        ? Math.max(1, (Math.max(...data.timestamps) - Math.min(...data.timestamps)) / 86400000)
        : 1;
    users.push({
      id: uid,
      name: member ? displayName(member, data.name) : data.name,
      msgCount: data.timestamps.length,
      tzOffset,
      tzLabel,
      offset,
      hourCounts,
      dowCounts,
      windows,
      sessions: sessions.length,
      avgSessionMin:
        sessions.length > 0
          ? Math.round(
              sessions.reduce((a, s) => a + (s.end - s.start), 0) / sessions.length / 60000,
            )
          : 0,
      avgStart,
      spanDays,
      msgsPerDay: Math.round((data.timestamps.length / spanDays) * 10) / 10,
    });
  }
  console.log(`\nAnalyzed ${users.length} users (≥${MIN_MSGS_FOR_USER} msgs).`);
  if (EXCLUDE_IDS.size) {
    users = users.filter((u) => !EXCLUDE_IDS.has(u.id));
    console.log(`After excluding ${EXCLUDE_IDS.size} exiled IDs: ${users.length} users in report.`);
  }

  // Guild heatmap (UTC)
  const guildUtcHours = Array(24).fill(0);
  const guildHstHours = Array(24).fill(0);
  const tzPop = new Map();
  for (const u of users) {
    for (let h = 0; h < 24; h++) {
      if (u.tzOffset != null) {
        const utcH = ((h - u.tzOffset) % 24 + 24) % 24;
        guildUtcHours[Math.floor(utcH)] += u.hourCounts[h];
      } else {
        guildUtcHours[h] += u.hourCounts[h];
      }
      guildHstHours[h] += u.hourCounts[h]; // only correct for HST users; also build explicit HST
    }
    const key = u.tzLabel.split("(")[0].trim();
    tzPop.set(key, (tzPop.get(key) || 0) + 1);
  }
  // Server-local HST aggregate (UTC-10)
  const guildHst = Array(24).fill(0);
  for (const [uid, data] of userEvents) {
    if (EXCLUDE_IDS.has(uid)) continue;
    for (const ts of data.timestamps) {
      guildHst[Math.floor(localHour(new Date(ts).toISOString(), -10))]++;
    }
  }
  const peakUtc = guildUtcHours.indexOf(Math.max(...guildUtcHours));
  const peakHst = guildHst.indexOf(Math.max(...guildHst));

  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const guildDow = Array(7).fill(0);
  for (const [uid, data] of userEvents) {
    if (EXCLUDE_IDS.has(uid)) continue;
    for (const ts of data.timestamps) {
      guildDow[localDow(new Date(ts).toISOString(), -10)]++;
    }
  }
  const topDow = guildDow.map((c, i) => ({ c, i })).sort((a, b) => b.c - a.c)[0];

  const generated = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const totalMsgs = users.reduce((a, u) => a + u.msgCount, 0);

  const parts = [];
  const excludeNote = `\n_Excludes **${EXCLUDE_IDS.size}** permanently exiled accounts from all activity stats._`;

  parts.push(`# RootMC — User activity & expected online times
_Generated ${generated} · Guild \`${GUILD_ID}\` · Sample: last **${MAX_AGE_DAYS} days**, **${totalMsgs}** human messages across **${textChannels.length}** channels (bot-spam & daily digest excluded)._${excludeNote}

## Method
• **Activity signal:** Discord messages (human only) — each message = presence proxy
• **Sessions:** gaps **>${SESSION_GAP_MS / 60000} min** start a new session
• **Active window:** local hours with ≥8% of that user's messages (contiguous ranges merged)
• **Timezone:** from member role \`TZ UTC±N …\` (set via #timezone-selector); unset → UTC for personal charts, HST for server peaks

## Server-wide patterns (HST / UTC-10)
• **Peak hour (HST):** ~**${fmtHour(peakHst)}** — best time for live events & staff coverage
• **Peak hour (UTC):** ~**${fmtHour(peakUtc)} UTC** — cross-TZ coordination reference
• **Busiest weekday (HST):** **${DOW[topDow.i]}** (${topDow.c} msgs in sample)

## Timezone role adoption (${users.length} active users)
${[...tzPop.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `• **${k}** — ${v} user(s)`)
  .join("\n") || "• No TZ roles detected — encourage #timezone-selector"}

## HST activity heatmap (all users, local hour)
\`\`\`
${guildHst
  .map((c, h) => {
    const bar = "█".repeat(Math.min(20, Math.round((c / Math.max(...guildHst)) * 20)));
    return `${String(h).padStart(2, "0")}:00 ${bar} ${c}`;
  })
  .join("\n")}
\`\`\`

---

`);

  const topUsers = users.slice(0, 35);
  for (const u of topUsers) {
    const winStr =
      u.windows.length > 0
        ? u.windows.map((w) => fmtHourRange(w.start, w.end % 24)).join(", ")
        : "—";
    const peakH = u.hourCounts.indexOf(Math.max(...u.hourCounts));
    const topD = u.dowCounts.map((c, i) => ({ c, i })).sort((a, b) => b.c - a.c)[0];
    const tzNote =
      u.tzOffset != null
        ? `**${u.tzLabel}** (UTC${u.tzOffset >= 0 ? "+" : ""}${u.tzOffset})`
        : "**TZ not set** — pick role in #timezone-selector";
    parts.push(`### ${u.name} (\`${u.id}\`)
• **Messages:** ${u.msgCount} over ~${Math.round(u.spanDays)}d (~${u.msgsPerDay}/day) · **Sessions:** ${u.sessions} (avg ~${u.avgSessionMin} min)
• **Timezone role:** ${tzNote}
• **Typical active window (local):** ${winStr}
• **Peak local hour:** ~${fmtHour(peakH)} · **Busiest day:** ${DOW[topD.i]}
• **Expected online:** Usually **${DOW[topD.i]} ${winStr}** in their timezone — good for DM/pings outside peak bot hours
`);
  }

  if (users.length > topUsers.length) {
    parts.push(
      `_+${users.length - topUsers.length} more users with ≥${MIN_MSGS_FOR_USER} messages omitted for length — re-run with higher Discord limits or query D1 \`discord_message_activity\` for full export._\n`,
    );
  }

  parts.push(`## Recommendations
1. **Unset TZ roles** — direct users to #timezone-selector so windows render in local time
2. **Staff coverage** — align mod shifts with HST peak (~${fmtHour(peakHst)}) + secondary UTC peak
3. **Event scheduling** — target **${DOW[topDow.i]} ${fmtHourRange(Math.max(0, peakHst - 1), peakHst + 2)} HST** for max concurrent humans
4. **Town/nation leads** — use per-user windows above before diplomacy meetings or build announcements

_Data source: live Discord scan (D1 \`discord_message_activity\` ingest adds history over time via */10 cron)._
_Re-run: \`node scripts/post-rootmc-user-activity-report.mjs --channel ${POST_CHANNEL}\`_`);

  const messages = chunkMessages(parts);
  console.log(`Report: ${messages.length} message(s)`);

  if (DRY_RUN) {
    const out = path.join(process.cwd(), "scripts", "user-activity-report.txt");
    fs.writeFileSync(out, parts.join(""), "utf8");
    console.log(`Dry run → ${out}`);
    return;
  }

  let last;
  for (let i = 0; i < messages.length; i++) {
    const res = await fetch(`${API}/channels/${POST_CHANNEL}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: messages[i] }),
    });
    if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text().catch(() => "")}`);
    last = await res.json();
    console.log(`Posted ${i + 1}/${messages.length}`);
    await sleep(650);
  }
  console.log(`Done → https://discord.com/channels/${GUILD_ID}/${POST_CHANNEL}/${last?.id || ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
