/**
 * Pulls new posts from a Discord text channel into `developer_messages` (mobile Settings feed).
 *
 * Setup:
 * 1. Discord Developer Portal → Application → Bot → reset token → `wrangler secret put DISCORD_BOT_TOKEN`
 * 2. Enable **Privileged Message Content Intent** (Bot tab) so the API returns `content` in guild channels.
 * 3. Invite bot to your server with **Read Messages/View Channel** + **Read Message History** on the announcements channel.
 * 4. Set `DISCORD_ANNOUNCEMENTS_CHANNEL_ID` in wrangler.toml [vars] (right-click channel → Copy ID with Dev Mode on).
 *
 * Cron: rootrecord-api-account Worker, every-five-minutes schedule, calls runDiscordDeveloperMessageSync.
 *
 * Also upserts `discord_user_activity` when a **new** `developer_messages` row is inserted
 * (same poll — not full-gateway presence). Ops on **account** Worker (`X-RR-Push-Admin-Key`):
 * GET `/api/internal/discord-user-activity`, POST `/api/internal/discord-channel-backfill`
 * (paginated history scan; call repeatedly with body `{ "before": "<next_before>" }` until `done`).
 */

import type { D1Database } from "@cloudflare/workers-types";

export interface DiscordDeveloperSyncEnv {
  DB: D1Database;
  DISCORD_ANNOUNCEMENTS_CHANNEL_ID?: string;
  DISCORD_BOT_TOKEN?: string;
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

/** Oldest-first batch (same ordering contract as `runDiscordDeveloperMessageSync`). */
async function processOrderedDiscordAnnouncementsMessages(
  env: DiscordDeveloperSyncEnv,
  ordered: DiscordMessage[],
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

    let anyNewInsert = false;
    for (const scope of scopes) {
      const rowId = `discord:${m.id}:${scope}`;
      try {
        const r = await env.DB.prepare(
          `INSERT OR IGNORE INTO developer_messages (id, title, body, app_scope, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
          .bind(rowId, title.slice(0, 200), body, scope, created_at)
          .run();
        if (r.meta?.changes === 1) {
          inserted += 1;
          anyNewInsert = true;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(JSON.stringify({ msg: "discord_developer_sync_insert_err", err: msg.slice(0, 200), rowId }));
      }
    }

    if (anyNewInsert && m.author?.id && !m.author.bot) {
      try {
        await upsertDiscordUserActivity(env.DB, m.author, created_at, m.id);
        await bumpDiscordActivityDaily(env.DB, created_at);
        activityUpserts += 1;
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

async function bumpDiscordActivityDaily(db: D1Database, messageIsoUtc: string): Promise<void> {
  const day = messageIsoUtc.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  await db
    .prepare(
      `INSERT INTO discord_activity_daily (day, message_count) VALUES (?, 1)
       ON CONFLICT(day) DO UPDATE SET message_count = discord_activity_daily.message_count + 1`,
    )
    .bind(day)
    .run();
}

export async function runDiscordDeveloperMessageSync(env: DiscordDeveloperSyncEnv): Promise<{
  ok: boolean;
  inserted: number;
  activity_upserts: number;
  skipped: string;
}> {
  const token = String(env.DISCORD_BOT_TOKEN || "").trim();
  const channelId = String(env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID || "").trim();
  if (!token || !channelId) {
    return { ok: true, inserted: 0, activity_upserts: 0, skipped: "discord_not_configured" };
  }

  const res = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages?limit=25`, {
    headers: {
      Authorization: `Bot ${token}`,
      "User-Agent": DISCORD_FETCH_UA,
    },
  });

  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 400);
    console.error(
      JSON.stringify({ msg: "discord_developer_sync_http", status: res.status, channel_id: channelId, snippet }),
    );
    return { ok: false, inserted: 0, activity_upserts: 0, skipped: `discord_http_${res.status}` };
  }

  let messages: DiscordMessage[];
  try {
    messages = (await res.json()) as DiscordMessage[];
  } catch {
    return { ok: false, inserted: 0, activity_upserts: 0, skipped: "discord_json_parse" };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: true, inserted: 0, activity_upserts: 0, skipped: "no_messages" };
  }

  /** Discord returns newest-first; insert oldest-first so ordering feels natural. */
  const ordered = [...messages].reverse();
  const { inserted, activityUpserts } = await processOrderedDiscordAnnouncementsMessages(env, ordered);

  if (inserted > 0 || activityUpserts > 0) {
    console.log(
      JSON.stringify({
        msg: "discord_developer_sync_ok",
        inserted,
        activity_upserts: activityUpserts,
        channel_id: channelId,
      }),
    );
  }
  return { ok: true, inserted, activity_upserts: activityUpserts, skipped: "ok" };
}

/**
 * Walk older messages via `before` pagination (100/msg page). Same insert rules as the cron
 * sync. Re-invoke with `before: next_before` from the JSON until `done` is true.
 */
export async function runDiscordAnnouncementsHistoryBackfill(
  env: DiscordDeveloperSyncEnv,
  opts: { before?: string | null; max_pages?: number },
): Promise<{
  ok: boolean;
  skipped: string;
  inserted: number;
  activity_upserts: number;
  pages_fetched: number;
  messages_scanned: number;
  done: boolean;
  next_before: string | null;
}> {
  const token = String(env.DISCORD_BOT_TOKEN || "").trim();
  const channelId = String(env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID || "").trim();
  if (!token || !channelId) {
    return {
      ok: true,
      skipped: "discord_not_configured",
      inserted: 0,
      activity_upserts: 0,
      pages_fetched: 0,
      messages_scanned: 0,
      done: true,
      next_before: null,
    };
  }

  const maxPages = Math.min(50, Math.max(1, Math.floor(opts.max_pages ?? 30)));
  let beforeCursor = (opts.before != null ? String(opts.before) : "").trim() || null;
  let inserted = 0;
  let activityUpserts = 0;
  let pages = 0;
  let scanned = 0;
  let nextBefore: string | null = null;

  while (pages < maxPages) {
    let url = `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages?limit=100`;
    if (beforeCursor) url += `&before=${encodeURIComponent(beforeCursor)}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bot ${token}`,
        "User-Agent": DISCORD_FETCH_UA,
      },
    });

    if (!res.ok) {
      const snippet = (await res.text()).slice(0, 400);
      console.error(JSON.stringify({ msg: "discord_backfill_http", status: res.status, channel_id: channelId, snippet }));
      return {
        ok: false,
        skipped: `discord_http_${res.status}`,
        inserted,
        activity_upserts: activityUpserts,
        pages_fetched: pages,
        messages_scanned: scanned,
        done: false,
        next_before: beforeCursor,
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
      };
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return {
        ok: true,
        skipped: "ok",
        inserted,
        activity_upserts: activityUpserts,
        pages_fetched: pages,
        messages_scanned: scanned,
        done: true,
        next_before: null,
      };
    }

    scanned += messages.length;
    const ordered = [...messages].reverse();
    const r = await processOrderedDiscordAnnouncementsMessages(env, ordered);
    inserted += r.inserted;
    activityUpserts += r.activityUpserts;

    const oldest = messages[messages.length - 1];
    const oldestId = oldest?.id ? String(oldest.id).trim() : null;
    beforeCursor = oldestId;
    nextBefore = oldestId;
    pages += 1;

    if (messages.length < 100) {
      console.log(
        JSON.stringify({
          msg: "discord_channel_backfill_batch",
          channel_id: channelId,
          pages,
          scanned,
          inserted,
          activity_upserts: activityUpserts,
          terminal: true,
        }),
      );
      return {
        ok: true,
        skipped: "ok",
        inserted,
        activity_upserts: activityUpserts,
        pages_fetched: pages,
        messages_scanned: scanned,
        done: true,
        next_before: null,
      };
    }
  }

  console.log(
    JSON.stringify({
      msg: "discord_channel_backfill_batch",
      channel_id: channelId,
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
  };
}
