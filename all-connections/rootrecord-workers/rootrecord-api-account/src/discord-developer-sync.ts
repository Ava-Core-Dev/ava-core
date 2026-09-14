/**
 * Pulls new posts from a Discord text channel into `developer_messages` (mobile Settings feed).
 *
 * Setup:
 * 1. Discord Developer Portal → Application → Bot → reset token → `wrangler secret put DISCORD_BOT_TOKEN`
 * 2. Enable **Privileged Message Content Intent** (Bot tab) so the API returns `content` in guild channels.
 * 3. Invite bot to your server with **Read Messages/View Channel** + **Read Message History** on the announcements channel.
 * 4. Set `DISCORD_ANNOUNCEMENTS_CHANNEL_ID` in wrangler.toml [vars] (right-click channel → Copy ID with Dev Mode on).
 * 5. Optional `DISCORD_GUILD_ID` [vars] — if unset, guild is resolved from the announcements channel (`GET /channels/:id`).
 *    All guild **text** (0), **news** (5), **forum** (15), and **thread** (10/11/12) channels the bot can see are listed in `discord_discovered_channels` and polled
 *    for **activity stats** only. Only the announcements channel writes `developer_messages` (mobile Settings feed).
 *
 * Cron: rootrecord-api-account Worker, `* * * * *` (every minute) schedule, calls runDiscordDeveloperMessageSync.
 *
 * Also upserts `discord_user_activity` once per Discord message id (`discord_channel_message_stats`)
 * so channel backfill can populate member stats for messages already in `developer_messages`.
 * Ops on **account** Worker (`X-RR-Push-Admin-Key`):
 * GET `/api/internal/discord-user-activity`, POST `/api/internal/discord-channel-backfill`
 * (paginated history scan; call repeatedly with body `{ "before": "<next_before>" }` until `done`).
 */

import type { D1Database } from "@cloudflare/workers-types";

export interface DiscordDeveloperSyncEnv {
  DB: D1Database;
  DISCORD_ANNOUNCEMENTS_CHANNEL_ID?: string;
  DISCORD_BOT_TOKEN?: string;
  /** Optional; otherwise resolved from the announcements channel. */
  DISCORD_GUILD_ID?: string;
}

interface DiscordAuthor {
  id?: string;
  username?: string;
  global_name?: string | null;
  bot?: boolean;
}

interface DiscordMessage {
  id: string;
  type?: number;
  content?: string;
  timestamp?: string;
  author?: DiscordAuthor;
}

interface DiscordApiChannel {
  id?: string;
  type?: number;
  name?: string;
  position?: number | null;
  parent_id?: string | null;
  guild_id?: string;
}

/**
 * Routing: an author targets product apps via (a) explicit hashtags at the start/anywhere of
 * the message, or (b) the app name written naturally in the prose. Hashtags get stripped from
 * the stored body; natural-language mentions are left intact so the user can still read them.
 *
 *   Hashtags (case-insensitive, stripped from body):
 *     #weather-manager  -> weather
 *     #business-manager -> bm
 *     #account-hub      -> account_hub
 *     #token-manager    -> token_manager
 *     #kilauea-alerts   -> kilauea
 *     #all              -> all
 *
 *   Natural-language names (case-insensitive for the long forms; UPPERCASE-only for two-letter
 *   shortcodes to avoid false positives like the word "am"):
 *     "Weather Manager", "weather-manager", "WM"   -> weather
 *     "Business Manager", "business-manager", "BM" -> bm
 *     "Kīlauea", "Kilauea", "Kilauea Alerts"       -> kilauea
 *     "Account Hub", "account-hub", "AH"           -> account_hub
 *     "Token Manager", "token-manager", "TM"       -> token_manager
 *
 * If a message mentions NO app and has NO hashtag, it broadcasts to scope "all". One row per
 * matched scope (idempotent on `discord:<msg>:<scope>`), so "BM and Weather Manager" fans out
 * to exactly those two and stays out of the others.
 *
 * Scope strings here MUST stay in sync with the POST validation list + `scopeForAppId` in
 * `developer-messages.ts` across every shard.
 */
const HASHTAG_TO_SCOPE: ReadonlyArray<readonly [string, string]> = [
  ["#weather-manager", "weather"],
  ["#business-manager", "bm"],
  ["#account-hub", "account_hub"],
  ["#token-manager", "token_manager"],
  ["#kilauea-alerts", "kilauea"],
  ["#blocknotes", "blocknotes"],
  ["#root-goals", "root_goals"],
  ["#root-farms", "root_farms"],
  ["#solana-tools", "solana"],
  ["#visiting-hawaii", "visiting_hawaii"],
  ["#all", "all"],
];

/**
 * Natural-language app-name patterns. Order does not matter (all are tested). The two-letter
 * shortcodes use a separate case-sensitive regex so casual lowercase ("am", "tm", "bm") in
 * prose does not accidentally route.
 */
const NAME_PATTERNS_CI: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bweather[\s-]?manager\b/gi, "weather"],
  [/\bbusiness[\s-]?manager\b/gi, "bm"],
  [/\bk[iī]lauea(?:[\s-]?alerts?)?\b/gi, "kilauea"],
  [/\baccount[\s-]?hub\b/gi, "account_hub"],
  [/\btoken[\s-]?manager\b/gi, "token_manager"],
  [/\bblock[\s-]?notes\b/gi, "blocknotes"],
  [/\broot[\s-]?goals\b/gi, "root_goals"],
  [/\broot[\s-]?farms\b/gi, "root_farms"],
  [/\bvisiting[\s-]?hawaii\b/gi, "visiting_hawaii"],
  [/\bsolana[\s-]?tools\b/gi, "solana"],
];
const NAME_PATTERNS_SHORTCODE: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bWM\b/g, "weather"],
  [/\bBM\b/g, "bm"],
  [/\bAH\b/g, "account_hub"],
  [/\bTM\b/g, "token_manager"],
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pull routing hashtags out of the message body, then scan the cleaned body for app name
 * mentions. Returns the fan-out scope list and the user-facing body (hashtags stripped, app
 * names preserved). Defaults to scope "all" when nothing targets a specific app.
 */
function parseScopesAndCleanBody(content: string): { scopes: string[]; body: string } {
  const found = new Set<string>();
  let cleaned = content;

  // 1) Hashtag pass — strip these out, they are routing metadata not user-visible content.
  for (const [tag, scope] of HASHTAG_TO_SCOPE) {
    const re = new RegExp(`(^|\\s)${escapeRegex(tag)}(?=\\s|[.,!?]|$)`, "gi");
    if (re.test(cleaned)) {
      found.add(scope);
      cleaned = cleaned.replace(re, " ");
    }
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // 2) Natural-language pass — read scope from prose without removing it. Run against the
  //    already-stripped body so a "#weather-manager" hashtag does not double-count.
  for (const [re, scope] of NAME_PATTERNS_CI) {
    if (re.test(cleaned)) found.add(scope);
    re.lastIndex = 0; // reset for next .test() call on a different input
  }
  for (const [re, scope] of NAME_PATTERNS_SHORTCODE) {
    if (re.test(cleaned)) found.add(scope);
    re.lastIndex = 0;
  }

  const scopes = found.size === 0 ? ["all"] : [...found];
  return { scopes, body: cleaned };
}

function displayAuthor(a: DiscordAuthor | undefined): string {
  if (!a) return "Team";
  const g = (a.global_name || "").trim();
  if (g) return g.slice(0, 80);
  const u = (a.username || "").trim();
  return u ? u.slice(0, 80) : "Team";
}

function isoFromDiscord(ts: string | undefined): string {
  if (!ts) return new Date().toISOString();
  try {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

const DISCORD_FETCH_UA = "RootRecordPrimaryWorker (discord sync; contact: root@rootrecord.info)";

async function discordAuthorizedGet(token: string, path: string): Promise<Response> {
  return fetch(`https://discord.com/api/v10${path.startsWith("/") ? path : `/${path}`}`, {
    headers: {
      Authorization: `Bot ${token}`,
      "User-Agent": DISCORD_FETCH_UA,
    },
  });
}

async function resolveGuildId(
  env: DiscordDeveloperSyncEnv,
  token: string,
  announcementsChannelId: string,
): Promise<string | null> {
  const fromEnv = String(env.DISCORD_GUILD_ID || "").trim();
  if (fromEnv) return fromEnv;
  const res = await discordAuthorizedGet(token, `/channels/${encodeURIComponent(announcementsChannelId)}`);
  if (!res.ok) return null;
  let ch: DiscordApiChannel;
  try {
    ch = (await res.json()) as DiscordApiChannel;
  } catch {
    return null;
  }
  const gid = ch?.guild_id != null ? String(ch.guild_id).trim() : "";
  return gid || null;
}

/** Upserts `discord_discovered_channels` and returns guild text/news channels (types 0 and 5), sorted. */
async function refreshDiscoveredChannelsInDb(
  env: DiscordDeveloperSyncEnv,
  token: string,
  guildId: string,
): Promise<{ id: string; type: number; name: string; position: number }[]> {
  const res = await discordAuthorizedGet(token, `/guilds/${encodeURIComponent(guildId)}/channels`);
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 200);
    console.error(JSON.stringify({ msg: "discord_guild_channels_http", status: res.status, snippet }));
    return [];
  }
  let list: DiscordApiChannel[];
  try {
    list = (await res.json()) as DiscordApiChannel[];
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const now = new Date().toISOString();
  /** Text, news, forum, and thread channel types that support message reads (best-effort). */
  const ingestible: { id: string; type: number; name: string; position: number }[] = [];
  for (const c of list) {
    const id = c?.id != null ? String(c.id).trim() : "";
    if (!id) continue;
    const type = c.type != null ? Number(c.type) : -1;
    const name = ((c.name != null ? String(c.name) : "") || "").trim() || id;
    const position = c.position != null && Number.isFinite(Number(c.position)) ? Number(c.position) : 0;
    const parent = c.parent_id != null ? String(c.parent_id) : null;
    try {
      await env.DB.prepare(
        `INSERT INTO discord_discovered_channels (channel_id, guild_id, name, type, position, parent_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel_id) DO UPDATE SET
           guild_id = excluded.guild_id,
           name = excluded.name,
           type = excluded.type,
           position = excluded.position,
           parent_id = excluded.parent_id,
           updated_at = excluded.updated_at`,
      )
        .bind(id, guildId, name.slice(0, 120), type, position, parent, now)
        .run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(JSON.stringify({ msg: "discord_discovered_channels_upsert_err", err: msg.slice(0, 200), id }));
    }
    if (type === 0 || type === 5 || type === 10 || type === 11 || type === 12 || type === 15) {
      ingestible.push({ id, type, name, position });
    }
  }
  ingestible.sort((a, b) => (a.position !== b.position ? a.position - b.position : a.name.localeCompare(b.name)));
  return ingestible;
}

async function loadIngestibleChannelsFromDb(db: D1Database, guildId: string): Promise<{ channel_id: string }[]> {
  const q = await db
    .prepare(
      `SELECT channel_id FROM discord_discovered_channels WHERE guild_id = ? AND type IN (0, 5, 10, 11, 12, 15) ORDER BY position ASC, name ASC`,
    )
    .bind(guildId)
    .all<{ channel_id: string }>();
  return (q.results ?? []).filter((r) => Boolean(r?.channel_id));
}

async function persistDiscordMessageStat(
  db: D1Database,
  channelId: string,
  messageId: string,
  createdAtIso: string,
): Promise<boolean> {
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO discord_channel_message_stats (discord_message_id, channel_id, created_at) VALUES (?, ?, ?)`,
    )
    .bind(messageId, channelId, createdAtIso)
    .run();
  return (r.meta?.changes ?? 0) === 1;
}

async function bumpDiscordActivityAfterNewStat(db: D1Database, messageIsoUtc: string, channelId: string): Promise<void> {
  const day = messageIsoUtc.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  await db
    .prepare(
      `INSERT INTO discord_activity_daily (day, message_count) VALUES (?, 1)
       ON CONFLICT(day) DO UPDATE SET message_count = discord_activity_daily.message_count + 1`,
    )
    .bind(day)
    .run();
  await db
    .prepare(
      `INSERT INTO discord_activity_daily_by_channel (day, channel_id, message_count) VALUES (?, ?, 1)
       ON CONFLICT(day, channel_id) DO UPDATE SET message_count = discord_activity_daily_by_channel.message_count + 1`,
    )
    .bind(day, channelId)
    .run();
}

/** Oldest-first batch (same ordering contract as `runDiscordDeveloperMessageSync`). */
async function processOrderedDiscordGuildMessages(
  env: DiscordDeveloperSyncEnv,
  ordered: DiscordMessage[],
  ctx: { channelId: string; ingestDeveloperFeed: boolean },
): Promise<{ inserted: number; activityUpserts: number }> {
  let inserted = 0;
  let activityUpserts = 0;
  for (const m of ordered) {
    if (!m?.id) continue;
    if (m.type != null && m.type !== 0) continue;
    const content = String(m.content || "").trim();
    if (!content) continue;
    if (m.author?.bot) continue;

    const title = displayAuthor(m.author);
    const { scopes, body: cleanedBody } = parseScopesAndCleanBody(content);
    if (!cleanedBody) continue;
    const body = cleanedBody.slice(0, 8000);
    const created_at = isoFromDiscord(m.timestamp);

    if (ctx.ingestDeveloperFeed) {
      for (const scope of scopes) {
        const rowId = `discord:${m.id}:${scope}`;
        try {
          const r = await env.DB.prepare(
            `INSERT OR IGNORE INTO developer_messages (id, title, body, app_scope, created_at) VALUES (?, ?, ?, ?, ?)`,
          )
            .bind(rowId, title.slice(0, 200), body, scope, created_at)
            .run();
          if (r.meta?.changes === 1) inserted += 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(JSON.stringify({ msg: "discord_developer_sync_insert_err", err: msg.slice(0, 200), rowId }));
        }
      }
    }

    const author = m.author;
    const mid = String(m.id).trim();
    if (author?.id && !author.bot && mid) {
      try {
        const firstStat = await persistDiscordMessageStat(env.DB, ctx.channelId, mid, created_at);
        if (firstStat) {
          await upsertDiscordUserActivity(env.DB, author, created_at, m.id);
          activityUpserts += 1;
          await bumpDiscordActivityAfterNewStat(env.DB, created_at, ctx.channelId);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(JSON.stringify({ msg: "discord_user_activity_upsert_err", err: msg.slice(0, 200), id: m.id }));
      }
    }
  }
  return { inserted, activityUpserts };
}

async function upsertDiscordUserActivity(
  db: D1Database,
  author: DiscordAuthor,
  lastMessageAt: string,
  lastMessageId: string,
): Promise<void> {
  const id = String(author.id || "").trim();
  if (!id) return;
  const username = (author.username || "").trim().slice(0, 80) || null;
  const globalName = (author.global_name != null ? String(author.global_name).trim().slice(0, 80) : "") || null;
  await db
    .prepare(
      `INSERT INTO discord_user_activity (discord_user_id, username, global_name, last_message_at, last_message_id, message_count, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
       ON CONFLICT(discord_user_id) DO UPDATE SET
         username = excluded.username,
         global_name = excluded.global_name,
         last_message_at = excluded.last_message_at,
         last_message_id = excluded.last_message_id,
         message_count = discord_user_activity.message_count + 1,
         updated_at = datetime('now')`,
    )
    .bind(id, username, globalName, lastMessageAt, lastMessageId)
    .run();
}

export async function runDiscordDeveloperMessageSync(env: DiscordDeveloperSyncEnv): Promise<{
  ok: boolean;
  inserted: number;
  activity_upserts: number;
  skipped: string;
}> {
  const token = String(env.DISCORD_BOT_TOKEN || "").trim();
  const announce = String(env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID || "").trim();
  if (!token || !announce) {
    return { ok: true, inserted: 0, activity_upserts: 0, skipped: "discord_not_configured" };
  }

  const guildId = await resolveGuildId(env, token, announce);
  let channelTargets: { id: string; ingestDeveloperFeed: boolean }[];

  if (guildId) {
    await refreshDiscoveredChannelsInDb(env, token, guildId);
    const fromDb = await loadIngestibleChannelsFromDb(env.DB, guildId);
    channelTargets = fromDb.map((r) => ({
      id: r.channel_id,
      ingestDeveloperFeed: r.channel_id === announce,
    }));
    if (channelTargets.length === 0) {
      channelTargets = [{ id: announce, ingestDeveloperFeed: true }];
    }
  } else {
    channelTargets = [{ id: announce, ingestDeveloperFeed: true }];
  }

  let inserted = 0;
  let activityUpserts = 0;

  for (const ch of channelTargets) {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${encodeURIComponent(ch.id)}/messages?limit=25`,
      {
        headers: {
          Authorization: `Bot ${token}`,
          "User-Agent": DISCORD_FETCH_UA,
        },
      },
    );
    if (!res.ok) {
      const snippet = (await res.text()).slice(0, 400);
      console.error(
        JSON.stringify({ msg: "discord_developer_sync_http", status: res.status, channel_id: ch.id, snippet }),
      );
      continue;
    }
    let messages: DiscordMessage[];
    try {
      messages = (await res.json()) as DiscordMessage[];
    } catch {
      continue;
    }
    if (!Array.isArray(messages) || messages.length === 0) continue;
    const ordered = [...messages].reverse();
    const r = await processOrderedDiscordGuildMessages(env, ordered, {
      channelId: ch.id,
      ingestDeveloperFeed: ch.ingestDeveloperFeed,
    });
    inserted += r.inserted;
    activityUpserts += r.activityUpserts;
  }

  if (inserted > 0 || activityUpserts > 0) {
    console.log(
      JSON.stringify({
        msg: "discord_developer_sync_ok",
        inserted,
        activity_upserts: activityUpserts,
        guild_id: guildId || null,
        channels_polled: channelTargets.length,
      }),
    );
  }
  return { ok: true, inserted, activity_upserts: activityUpserts, skipped: "ok" };
}

/**
 * Paginated history: walks all discovered guild text/news channels. Body JSON:
 * `{ "before": "<snowflake>", "channel_id": "<id>", "max_pages": 30 }`
 * — when a channel finishes, response includes `next_channel_id` (use with `before: null`).
 */
export async function runDiscordAnnouncementsHistoryBackfill(
  env: DiscordDeveloperSyncEnv,
  opts: { before?: string | null; max_pages?: number; channel_id?: string | null },
): Promise<{
  ok: boolean;
  skipped: string;
  inserted: number;
  activity_upserts: number;
  pages_fetched: number;
  messages_scanned: number;
  done: boolean;
  next_before: string | null;
  active_channel_id: string | null;
  next_channel_id: string | null;
  channel_done: boolean;
}> {
  const token = String(env.DISCORD_BOT_TOKEN || "").trim();
  const announce = String(env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID || "").trim();
  if (!token || !announce) {
    return {
      ok: true,
      skipped: "discord_not_configured",
      inserted: 0,
      activity_upserts: 0,
      pages_fetched: 0,
      messages_scanned: 0,
      done: true,
      next_before: null,
      active_channel_id: null,
      next_channel_id: null,
      channel_done: false,
    };
  }

  const maxPages = Math.min(50, Math.max(1, Math.floor(opts.max_pages ?? 30)));
  const guildId = await resolveGuildId(env, token, announce);

  let chRows: { channel_id: string }[] = [];
  if (guildId) {
    await refreshDiscoveredChannelsInDb(env, token, guildId);
    chRows = await loadIngestibleChannelsFromDb(env.DB, guildId);
  }
  if (chRows.length === 0) {
    chRows = [{ channel_id: announce }];
  }

  const chIds = chRows.map((r) => r.channel_id);
  let activeId = (opts.channel_id != null ? String(opts.channel_id).trim() : "") || chIds[0] || announce;
  if (!chIds.includes(activeId)) activeId = chIds[0] || announce;

  const announceIngest = activeId === announce;
  let beforeCursor = (opts.before != null ? String(opts.before) : "").trim() || null;
  let inserted = 0;
  let activityUpserts = 0;
  let pages = 0;
  let scanned = 0;
  let nextBefore: string | null = null;

  while (pages < maxPages) {
    let url = `https://discord.com/api/v10/channels/${encodeURIComponent(activeId)}/messages?limit=100`;
    if (beforeCursor) url += `&before=${encodeURIComponent(beforeCursor)}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bot ${token}`,
        "User-Agent": DISCORD_FETCH_UA,
      },
    });

    if (!res.ok) {
      const snippet = (await res.text()).slice(0, 400);
      console.error(
        JSON.stringify({ msg: "discord_backfill_http", status: res.status, channel_id: activeId, snippet }),
      );
      return {
        ok: false,
        skipped: `discord_http_${res.status}`,
        inserted,
        activity_upserts: activityUpserts,
        pages_fetched: pages,
        messages_scanned: scanned,
        done: false,
        next_before: beforeCursor,
        active_channel_id: activeId,
        next_channel_id: null,
        channel_done: false,
      };
    }

    let messages: DiscordMessage[];
    try {
      messages = (await res.json()) as DiscordMessage[];
    } catch {
      return {
        ok: false,
        skipped: "discord_json_parse",
        inserted,
        activity_upserts: activityUpserts,
        pages_fetched: pages,
        messages_scanned: scanned,
        done: false,
        next_before: beforeCursor,
        active_channel_id: activeId,
        next_channel_id: null,
        channel_done: false,
      };
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      const idx = chIds.indexOf(activeId);
      const nextCh = idx >= 0 && idx + 1 < chIds.length ? chIds[idx + 1]! : null;
      const allDone = nextCh == null;
      console.log(
        JSON.stringify({
          msg: "discord_channel_backfill_batch",
          channel_id: activeId,
          pages,
          scanned,
          inserted,
          activity_upserts: activityUpserts,
          terminal: true,
          channel_done: true,
          next_channel_id: nextCh,
        }),
      );
      return {
        ok: true,
        skipped: "ok",
        inserted,
        activity_upserts: activityUpserts,
        pages_fetched: pages,
        messages_scanned: scanned,
        done: allDone,
        next_before: null,
        active_channel_id: activeId,
        next_channel_id: nextCh,
        channel_done: true,
      };
    }

    scanned += messages.length;
    const ordered = [...messages].reverse();
    const r = await processOrderedDiscordGuildMessages(env, ordered, {
      channelId: activeId,
      ingestDeveloperFeed: announceIngest,
    });
    inserted += r.inserted;
    activityUpserts += r.activityUpserts;

    const oldest = messages[messages.length - 1];
    const oldestId = oldest?.id ? String(oldest.id).trim() : null;
    beforeCursor = oldestId;
    nextBefore = oldestId;
    pages += 1;

    if (messages.length < 100) {
      const idx = chIds.indexOf(activeId);
      const nextCh = idx >= 0 && idx + 1 < chIds.length ? chIds[idx + 1]! : null;
      const allDone = nextCh == null;
      console.log(
        JSON.stringify({
          msg: "discord_channel_backfill_batch",
          channel_id: activeId,
          pages,
          scanned,
          inserted,
          activity_upserts: activityUpserts,
          terminal: true,
          next_channel_id: nextCh,
        }),
      );
      return {
        ok: true,
        skipped: "ok",
        inserted,
        activity_upserts: activityUpserts,
        pages_fetched: pages,
        messages_scanned: scanned,
        done: allDone,
        next_before: null,
        active_channel_id: activeId,
        next_channel_id: nextCh,
        channel_done: true,
      };
    }
  }

  console.log(
    JSON.stringify({
      msg: "discord_channel_backfill_batch",
      channel_id: activeId,
      pages_fetched: pages,
      messages_scanned: scanned,
      inserted,
      activity_upserts: activityUpserts,
      done: false,
      next_before: nextBefore,
    }),
  );

  return {
    ok: true,
    skipped: "ok",
    inserted,
    activity_upserts: activityUpserts,
    pages_fetched: pages,
    messages_scanned: scanned,
    done: false,
    next_before: nextBefore,
    active_channel_id: activeId,
    next_channel_id: null,
    channel_done: false,
  };
}
