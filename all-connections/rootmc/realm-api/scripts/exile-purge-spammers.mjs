/**
 * Purge exiled Discord users: messages, links, D1 + MySQL player data.
 * Does NOT ban/kick guild members.
 *
 * Usage:
 *   node scripts/exile-purge-spammers.mjs
 *   node scripts/exile-purge-spammers.mjs --dry-run
 */
import fs from "node:fs";
import mysql from "mysql2/promise";
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";
import { findCredentialsPath } from "./lib/rootmc-paths.mjs";
import { EXILED_DISCORD_USERS } from "./lib/rootmc-exiled-discord-ids.mjs";

const env = loadRootMcEnv();
if (env.CLOUDFLARE_API_TOKEN) process.env.CLOUDFLARE_API_TOKEN = env.CLOUDFLARE_API_TOKEN;
if (env.CLOUDFLARE_ACCOUNT_ID) process.env.CLOUDFLARE_ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID;

const API = "https://discord.com/api/v10";
const GUILD_ID = "1516108585740800042";
const REPORT_CHANNEL = "1520371322033668216";
const ACTIVITY_CHANNEL = "1520369402795659304";
const D1_DATABASE_ID = "6cf71128-67e3-47b2-a802-d6c23d6489e0";
const CF_ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID || "f3372b30093435bacc35b69972abeb2e";

/** Exiled spammers / undesirables — Discord user IDs only (canonical: src/rootmc-exiled-discord-users.json). */
export const EXILES = EXILED_DISCORD_USERS;

const EXILE_IDS = new Set(EXILES.map((e) => e.id));
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_DISCORD = process.argv.includes("--skip-discord") || process.argv.includes("--d1-only");
const SKIP_REPORT = process.argv.includes("--skip-report");

const botToken = rootMcBotToken(env);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sqlQuoteList(ids) {
  return ids.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(", ");
}

function mergeProcessEnv() {
  return { ...process.env, ...env };
}

function cfToken() {
  for (const p of [findCredentialsPath(), process.env.ROOTMC_ENV_FILE].filter(Boolean)) {
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line.startsWith("CLOUDFLARE_API_TOKEN=")) continue;
      const v = line.slice("CLOUDFLARE_API_TOKEN=".length).trim();
      if (v.length > 20) return v;
    }
  }
  return String(process.env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN || "").trim();
}

async function d1QueryHttp(sql) {
  const token = cfToken();
  if (token.length < 20) throw new Error("CLOUDFLARE_API_TOKEN missing (Desktop RootMC .env)");
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    },
  );
  const data = await res.json();
  if (!data.success) {
    throw new Error(`D1 HTTP: ${JSON.stringify(data.errors || data).slice(0, 400)}`);
  }
  return data.result?.[0]?.results || [];
}

async function d1ExecStatements(sqlText) {
  const stmts = sqlText
    .split(";")
    .map((s) => s.replace(/--[^\n]*/g, "").trim())
    .filter(Boolean);
  for (const sql of stmts) {
    if (DRY_RUN) {
      console.log("DRY SQL:", sql.slice(0, 120));
      continue;
    }
    await d1QueryHttp(sql);
  }
}

const d1Query = d1QueryHttp;

async function d1ExecFile(sql) {
  return d1ExecStatements(sql);
}

async function discordFetch(method, pathSuffix, body) {
  const res = await fetch(`${API}${pathSuffix}`, {
    method,
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
      "User-Agent": "RootRecord/rootmc-exile-purge",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429) {
    const j = await res.json().catch(() => ({}));
    await sleep(Math.ceil((j.retry_after || 1) * 1000) + 300);
    return discordFetch(method, pathSuffix, body);
  }
  return res;
}

async function deleteMessage(channelId, messageId) {
  if (DRY_RUN) return true;
  const res = await discordFetch("DELETE", `/channels/${channelId}/messages/${messageId}`);
  return res.ok || res.status === 404;
}

async function deleteChannel(channelId) {
  if (DRY_RUN) return true;
  const res = await discordFetch("DELETE", `/channels/${channelId}`);
  return res.ok || res.status === 404;
}

async function purgeChannelMessages(channelId, channelName, stats) {
  let before = "";
  let pages = 0;
  const maxPages = 80;
  while (pages < maxPages) {
    const qs = new URLSearchParams({ limit: "100" });
    if (before) qs.set("before", before);
    const res = await discordFetch("GET", `/channels/${channelId}/messages?${qs}`);
    if (!res.ok) break;
    const batch = await res.json();
    if (!Array.isArray(batch) || !batch.length) break;
    for (const m of batch) {
      const uid = String(m.author?.id || "");
      if (!EXILE_IDS.has(uid)) continue;
      const ok = await deleteMessage(channelId, m.id);
      if (ok) {
        stats.messagesDeleted++;
        stats.byUser[uid] = (stats.byUser[uid] || 0) + 1;
      }
      await sleep(280);
    }
    before = batch[batch.length - 1]?.id || "";
    pages++;
    if (batch.length < 100) break;
    await sleep(350);
  }
  stats.channelsScanned++;
  if (stats.messagesDeleted && stats.messagesDeleted % 20 === 0) {
    process.stdout.write(`  #${channelName}: ${stats.messagesDeleted} total deleted\r`);
  }
}

async function purgeForumThreads(forumId, stats) {
  for (const kind of ["active", "archived/public"]) {
    let pathSuffix = `/channels/${forumId}/threads/${kind}`;
    if (kind.includes("archived")) pathSuffix += "?limit=100";
    const res = await discordFetch("GET", pathSuffix);
    if (!res.ok) continue;
    const data = await res.json();
    const threads = data.threads || [];
    for (const t of threads) {
      const tid = t.id;
      const msgRes = await discordFetch("GET", `/channels/${tid}/messages?limit=1`);
      if (!msgRes.ok) continue;
      const msgs = await msgRes.json();
      const author = String(msgs[0]?.author?.id || "");
      if (!EXILE_IDS.has(author)) continue;
      if (await deleteChannel(tid)) {
        stats.threadsDeleted++;
        stats.byUser[author] = (stats.byUser[author] || 0) + 1;
      }
      await sleep(400);
    }
  }
}

async function resolveLinkedData() {
  const idList = sqlQuoteList([...EXILE_IDS]);
  const links = await d1Query(
    `SELECT discord_user_id, account_id, email, discord_username FROM discord_account_links WHERE discord_user_id IN (${idList})`,
  );
  const accountIds = [...new Set(links.map((r) => r.account_id).filter(Boolean))];
  let mcLinks = [];
  if (accountIds.length) {
    mcLinks = await d1Query(
      `SELECT account_id, minecraft_uuid, minecraft_username, email FROM rootstat_minecraft_links WHERE account_id IN (${sqlQuoteList(accountIds)})`,
    );
  }
  const uuids = [...new Set(mcLinks.map((r) => String(r.minecraft_uuid || "").toLowerCase()).filter(Boolean))];
  const usernames = [
    ...new Set(
      mcLinks
        .map((r) => String(r.minecraft_username || "").trim())
        .filter(Boolean)
        .concat(links.map((r) => String(r.discord_username || "").trim()).filter(Boolean)),
    ),
  ];

  let townChannels = [];
  let nationChannels = [];
  if (uuids.length) {
    const uuidList = sqlQuoteList(uuids);
    const towns = await d1Query(
      `SELECT town_uuid, town_name, mayor_uuid FROM rootmc_towny_towns WHERE LOWER(mayor_uuid) IN (${uuidList})`,
    );
    const nations = await d1Query(
      `SELECT nation_uuid, nation_name, leader_uuid FROM rootmc_towny_nations WHERE LOWER(leader_uuid) IN (${uuidList})`,
    );
    if (towns.length) {
      const tuuids = sqlQuoteList(towns.map((t) => t.town_uuid));
      townChannels = await d1Query(
        `SELECT channel_id, town_uuid FROM rootmc_discord_town_channels WHERE town_uuid IN (${tuuids})`,
      );
    }
    if (nations.length) {
      const nuuids = sqlQuoteList(nations.map((n) => n.nation_uuid));
      nationChannels = await d1Query(
        `SELECT channel_id, nation_uuid FROM rootmc_discord_nation_channels WHERE nation_uuid IN (${nuuids})`,
      );
    }
  }

  return { links, mcLinks, accountIds, uuids, usernames, townChannels, nationChannels };
}

function buildD1PurgeSql(accountIds, uuids) {
  const dList = sqlQuoteList([...EXILE_IDS]);
  const stmts = [
    `-- exile purge ${new Date().toISOString()}`,
    `DELETE FROM discord_message_activity WHERE discord_user_id IN (${dList});`,
    `DELETE FROM discord_reaction_activity WHERE discord_user_id IN (${dList});`,
    `DELETE FROM discord_user_activity WHERE discord_user_id IN (${dList});`,
    `DELETE FROM rootmc_active_participant_awards WHERE discord_user_id IN (${dList});`,
    `DELETE FROM rootmc_community_proposal_votes WHERE discord_user_id IN (${dList});`,
    `DELETE FROM rr_earn_discord_peer_transfer WHERE from_discord_user_id IN (${dList}) OR to_discord_user_id IN (${dList});`,
    `DELETE FROM discord_account_links WHERE discord_user_id IN (${dList});`,
  ];

  if (accountIds.length) {
    const aList = sqlQuoteList(accountIds);
    stmts.push(
      `DELETE FROM rootmc_player_profiles WHERE account_id IN (${aList});`,
      `DELETE FROM rootmc_shared_worlds WHERE account_id IN (${aList});`,
      `DELETE FROM rootmc_world_ai_reports WHERE user_id IN (SELECT id FROM users WHERE account_id IN (${aList}));`,
      `DELETE FROM rootmc_friend_requests WHERE from_account_id IN (${aList}) OR to_account_id IN (${aList});`,
      `DELETE FROM rootmc_friendships WHERE account_id_a IN (${aList}) OR account_id_b IN (${aList});`,
      `DELETE FROM rootmc_group_members WHERE account_id IN (${aList});`,
      `DELETE FROM rootmc_group_invites WHERE inviter_account_id IN (${aList}) OR invitee_account_id IN (${aList});`,
      `DELETE FROM rootmc_group_messages WHERE sender_account_id IN (${aList});`,
      `DELETE FROM rootmc_shop_price_alerts WHERE account_id IN (${aList});`,
      `DELETE FROM rootmc_account_snapshot WHERE account_id IN (${aList});`,
      `DELETE FROM rootmc_vault_orders WHERE account_id IN (${aList});`,
    );
  }

  if (uuids.length) {
    const uList = sqlQuoteList(uuids);
    const uLower = uuids.map((u) => `'${u.toLowerCase()}'`).join(", ");
    stmts.push(
      `DELETE FROM rootstat_minecraft_links WHERE LOWER(minecraft_uuid) IN (${uLower});`,
      `DELETE FROM rootstat_link_codes WHERE LOWER(minecraft_uuid) IN (${uLower});`,
      `DELETE FROM rootstat_mcmmo_stats WHERE LOWER(minecraft_uuid) IN (${uLower});`,
      `DELETE FROM rootstat_player_playtime WHERE LOWER(minecraft_uuid) IN (${uLower});`,
      `DELETE FROM rootstat_player_balances WHERE LOWER(minecraft_uuid) IN (${uLower});`,
      `DELETE FROM rootstat_player_item_totals WHERE LOWER(minecraft_uuid) IN (${uLower});`,
      `DELETE FROM rootstat_player_net_worth WHERE LOWER(minecraft_uuid) IN (${uLower});`,
      `DELETE FROM rootmc_ingame_events WHERE LOWER(minecraft_uuid) IN (${uLower});`,
      `DELETE FROM rootmc_blueprints WHERE LOWER(minecraft_uuid) IN (${uLower});`,
      `DELETE FROM rootmc_ask_turns WHERE LOWER(minecraft_uuid) IN (${uLower});`,
      `DELETE FROM rootmc_ingame_ask_daily WHERE LOWER(minecraft_uuid) IN (${uLower});`,
      `DELETE FROM rootmc_playtime_monthly WHERE LOWER(minecraft_uuid) IN (${uLower});`,
      `DELETE FROM rootmc_treasury_dividend_payouts WHERE LOWER(minecraft_uuid) IN (${uLower});`,
      `DELETE FROM rootmc_weekly_playtime_awards WHERE LOWER(minecraft_uuid) IN (${uLower});`,
      `DELETE FROM rootmc_gold_transfers WHERE LOWER(from_uuid) IN (${uLower}) OR LOWER(to_uuid) IN (${uLower});`,
      `DELETE FROM rootmc_discord_town_channels WHERE town_uuid IN (SELECT town_uuid FROM rootmc_towny_towns WHERE LOWER(mayor_uuid) IN (${uLower}));`,
      `DELETE FROM rootmc_discord_nation_channels WHERE nation_uuid IN (SELECT nation_uuid FROM rootmc_towny_nations WHERE LOWER(leader_uuid) IN (${uLower}));`,
      `DELETE FROM rootmc_towny_towns WHERE LOWER(mayor_uuid) IN (${uLower});`,
      `DELETE FROM rootmc_towny_nations WHERE LOWER(leader_uuid) IN (${uLower});`,
    );
  }

  return stmts.join("\n");
}

async function purgeMysql(uuids, usernames) {
  const readDesktop = (key) => {
    for (const p of [findCredentialsPath(), process.env.ROOTMC_ENV_FILE].filter(Boolean)) {
      if (!fs.existsSync(p)) continue;
      for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
        const line = raw.trim();
        if (!line.startsWith(`${key}=`)) continue;
        const v = line.slice(key.length + 1).trim();
        if (v) return v;
      }
    }
    return env[key] || process.env[key] || "";
  };

  const host = readDesktop("ROOTMC_MYSQL_HOST");
  const user = readDesktop("ROOTMC_MYSQL_USER");
  const password = readDesktop("ROOTMC_MYSQL_PASS") || readDesktop("ROOTMC_MYSQL_PASSWORD");
  const database = readDesktop("ROOTMC_MYSQL_DB");
  const port = Number(readDesktop("ROOTMC_MYSQL_PORT") || 3306);
  const prefix = readDesktop("ROOTMC_MYSQL_TABLE_PREFIX") || "root_";

  if (!host || !user || !password || !database) {
    return { ok: false, detail: "Set ROOTMC_MYSQL_HOST/USER/PASS/DB in Desktop RootMC _local/.env for in-game purge" };
  }

  const conn = await mysql.createConnection({ host, port, user, password, database });
  const stats = { balances: 0, playtime: 0, towns: 0, nations: 0, residents: 0 };

  try {
    if (uuids.length) {
      const ph = uuids.map(() => "?").join(", ");
      const [b] = await conn.execute(
        `DELETE FROM ${prefix}economy_balances WHERE LOWER(minecraft_uuid) IN (${ph})`,
        uuids.map((u) => u.toLowerCase()),
      );
      stats.balances = b.affectedRows || 0;

      try {
        const [p] = await conn.execute(`DELETE FROM ${prefix}rootmc_playtime_monthly WHERE LOWER(uuid) IN (${ph})`, uuids);
        stats.playtime = p.affectedRows || 0;
      } catch {
        /* table optional */
      }
    }

    const namePh = usernames.map(() => "?").join(", ");
    const uuidPh = uuids.map(() => "?").join(", ");
    if (usernames.length || uuids.length) {
      try {
        const params = [...usernames, ...uuids.map((u) => u.toLowerCase())];
        const cond = [
          usernames.length ? `LOWER(mayor) IN (${namePh})` : null,
          uuids.length ? `LOWER(mayor) IN (${uuidPh})` : null,
        ]
          .filter(Boolean)
          .join(" OR ");
        const [t] = await conn.execute(`DELETE FROM towny_towns WHERE ${cond}`, params);
        stats.towns = t.affectedRows || 0;
      } catch {
        /* towny optional */
      }
      try {
        if (uuids.length) {
          const [r] = await conn.execute(
            `DELETE FROM towny_residents WHERE LOWER(uuid) IN (${uuidPh})`,
            uuids.map((u) => u.toLowerCase()),
          );
          stats.residents = r.affectedRows || 0;
        }
      } catch {
        /* */
      }
    }
  } finally {
    await conn.end();
  }
  return { ok: true, stats };
}

async function postDiscord(channelId, content) {
  if (DRY_RUN) return null;
  const res = await fetch(`${API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: content.slice(0, 2000) }),
  });
  if (!res.ok) throw new Error(`Post failed ${res.status}`);
  return res.json();
}

function chunk(parts) {
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
  if (botToken.length < 40) throw new Error("DISCORD_ROOTMC_BOT_TOKEN required");

  console.log(DRY_RUN ? "DRY RUN" : "LIVE PURGE", `— ${EXILES.length} exiles`);

  let linked;
  try {
    linked = await resolveLinkedData();
    console.log(
      `D1 links: ${linked.links.length} discord · ${linked.mcLinks.length} minecraft · ${linked.uuids.length} UUIDs`,
    );
  } catch (e) {
    console.warn("D1 lookup failed (continuing Discord-only):", e.message);
    linked = {
      links: [],
      mcLinks: [],
      accountIds: [],
      uuids: [],
      usernames: [],
      townChannels: [],
      nationChannels: [],
    };
  }

  const msgStats = { messagesDeleted: 0, channelsScanned: 0, threadsDeleted: 0, channelsDeleted: 0, byUser: {} };

  console.log("Purging Discord messages…");
  if (!SKIP_DISCORD && !D1_ONLY) {
    const channels = await discordFetch("GET", `/guilds/${GUILD_ID}/channels`).then((r) => r.json());
    const textLike = (channels || []).filter((c) => [0, 5, 15].includes(c.type));
    for (const ch of textLike) {
      await purgeChannelMessages(ch.id, ch.name, msgStats);
      if (ch.type === 15) await purgeForumThreads(ch.id, msgStats);
    }

    const channelIdsToDelete = [
      ...new Set(
        [...linked.townChannels, ...linked.nationChannels].map((r) => r.channel_id).filter(Boolean),
      ),
    ];
    for (const cid of channelIdsToDelete) {
      if (await deleteChannel(cid)) msgStats.channelsDeleted++;
      await sleep(500);
    }
  } else {
    console.log("Skipping Discord pass (--skip-discord or --d1-only).");
  }

  let d1Ok = false;
  let mysqlResult = { ok: false, detail: "skipped" };
  if (linked.accountIds.length || linked.uuids.length || EXILE_IDS.size) {
    try {
      const sql = buildD1PurgeSql(linked.accountIds, linked.uuids);
      if (!DRY_RUN) await d1ExecFile(sql);
      d1Ok = true;
      console.log("D1 purge executed.");
    } catch (e) {
      console.error("D1 purge failed:", e.message);
    }
  }

  try {
    mysqlResult = await purgeMysql(linked.uuids, linked.usernames);
    if (mysqlResult.ok) console.log("MySQL purge:", mysqlResult.stats);
    else console.warn("MySQL:", mysqlResult.detail);
  } catch (e) {
    mysqlResult = { ok: false, detail: e.message };
    console.error("MySQL purge error:", e.message);
  }

  const generated = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const reportParts = [
    `# Exile purge report — spam / character removal
_${generated} · **${EXILES.length}** members · **No bans/kicks** (data-only purge)_

## Summary
• **Discord messages deleted:** ${msgStats.messagesDeleted}
• **Forum threads removed:** ${msgStats.threadsDeleted}
• **Town/nation Discord channels deleted:** ${msgStats.channelsDeleted}
• **Channels scanned:** ${msgStats.channelsScanned}
• **D1 database purge:** ${d1Ok ? "✅ executed" : "❌ failed or skipped"}
• **MySQL in-game purge:** ${mysqlResult.ok ? "✅ " + JSON.stringify(mysqlResult.stats) : "⚠️ " + (mysqlResult.detail || "failed")}

## Discord links removed
• \`discord_account_links\` — ${linked.links.length} row(s)
• \`rootstat_minecraft_links\` — ${linked.mcLinks.length} row(s)

## Exiled Discord IDs
${EXILES.map((e) => `• **${e.name}** \`${e.id}\` — msgs deleted: ${msgStats.byUser[e.id] || 0}`).join("\n")}

## Data destroyed (when D1/MySQL succeeded)
Discord activity, proposal votes, account/MC links, profiles, friends/groups, shop alerts, snapshots, vault orders, all rootstat stats (mcmmo, playtime, balances, net worth), ingame events, blueprints, ask history, gold transfers, towny D1 snapshots, town/nation Discord channel maps.

## In-game (MySQL)
Economy balances, playtime monthly, towny_towns (mayor match), towny_residents — live Towny world may need admin unclaim/reconcile if towns persist in-game.

## Not done (by design)
• Guild **ban/kick** — members may still be in server
• Other members' messages quoting exiles
• RootRecord main-shard accounts (only RootMC D1 on \`rootmc\` DB)

_Next: user-activity report refreshed excluding exiles._`,
  ];

  console.log("Posting report…");
  if (!SKIP_REPORT) {
    for (const part of chunk(reportParts)) {
      await postDiscord(REPORT_CHANNEL, part);
      await sleep(600);
    }
  }

  if (!SKIP_REPORT) {
    console.log("Refreshing user-activity report…");
  const { spawnSync: sync } = await import("node:child_process");
  sync(
    "node",
    ["scripts/post-rootmc-user-activity-report.mjs", "--channel", ACTIVITY_CHANNEL],
    { cwd: process.cwd(), stdio: "inherit", shell: true },
  );
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
