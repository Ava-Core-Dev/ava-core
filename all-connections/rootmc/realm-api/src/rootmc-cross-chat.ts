import { json } from "./cors";
import { record, str } from "./realm-lib";
import type { RootStatEnv } from "./rootstat-minecraft";
import { validateServerAuth } from "./rootstat-minecraft";

type CrossChatEnv = RootStatEnv & {
  CROSS_SERVER_CHAT_SECRET?: string;
};

const PRESENCE_STALE_MS = 35_000;

function stripMcColors(text: string): string {
  return text.replace(/§[0-9a-fk-or]/gi, "").replace(/&[0-9a-fk-or]/gi, "").trim();
}

function normalizeTag(raw: string): string {
  const t = stripMcColors(raw).toUpperCase();
  if (t === "G1" || t === "GEN1" || t === "1" || t === "T" || t === "TOWNY") return "G1";
  if (t === "G2" || t === "GEN2" || t === "2" || t === "C" || t === "CLAIMS") return "G2";
  return "";
}

function normalizeStatus(raw: string): "online" | "offline" | "" {
  const s = stripMcColors(raw).toLowerCase();
  if (s === "online" || s === "up" || s === "1") return "online";
  if (s === "offline" || s === "down" || s === "0") return "offline";
  return "";
}

function effectiveStatus(status: string, updatedAt: string): "online" | "offline" {
  if (status !== "online") return "offline";
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return "offline";
  if (Date.now() - ts > PRESENCE_STALE_MS) return "offline";
  return "online";
}

async function authorizeCrossChat(env: CrossChatEnv, request: Request): Promise<Response | true> {
  const secret = String(env.CROSS_SERVER_CHAT_SECRET || "").trim();
  const header =
    String(request.headers.get("X-Cross-Chat-Secret") || "").trim() ||
    String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (secret && header && header === secret) {
    return true;
  }
  const server = await validateServerAuth(env, request);
  if (server instanceof Response) {
    if (secret) {
      return json({ detail: "Invalid cross-chat secret or server auth." }, 401);
    }
    return server;
  }
  return true;
}

export async function handleRootMcCrossChat(
  request: Request,
  env: CrossChatEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (
    !subpath.startsWith("/rootmc/cross-chat") &&
    !subpath.startsWith("/rootmc/cross-presence") &&
    !subpath.startsWith("/rootmc/cross-return")
  ) {
    return null;
  }
  if (!env.DB) {
    return json({ detail: "Database not configured." }, 503);
  }

  if (method === "POST" && subpath === "/rootmc/cross-return") {
    const auth = await authorizeCrossChat(env, request);
    if (auth instanceof Response) return auth;

    let body: Record<string, unknown>;
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }

    const homeTag = normalizeTag(str(body.home_tag || body.homeTag));
    const holdingTag = normalizeTag(str(body.holding_tag || body.holdingTag));
    if (!homeTag || !holdingTag || homeTag === holdingTag) {
      return json({ detail: "home_tag and holding_tag are required and must differ." }, 400);
    }

    const playersRaw = body.players;
    const players: { uuid: string; username: string }[] = [];
    if (Array.isArray(playersRaw)) {
      for (const row of playersRaw) {
        if (!row || typeof row !== "object") continue;
        const rec = record(row as Record<string, unknown>);
        const uuid = stripMcColors(str(rec.uuid || rec.player_uuid)).slice(0, 36);
        const username = stripMcColors(str(rec.username || rec.name)).slice(0, 32);
        if (uuid) players.push({ uuid, username });
      }
    }
    if (players.length === 0) {
      return json({ detail: "players[] with uuid required." }, 400);
    }

    for (const p of players) {
      await env.DB.prepare(
        `INSERT INTO g2_cross_return (player_uuid, username, home_tag, holding_tag, created_at)
         VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(player_uuid) DO UPDATE SET
           username = excluded.username,
           home_tag = excluded.home_tag,
           holding_tag = excluded.holding_tag,
           created_at = excluded.created_at`,
      )
        .bind(p.uuid, p.username, homeTag, holdingTag)
        .run();
    }

    // Drop stale returns (>6h)
    await env.DB.prepare(
      `DELETE FROM g2_cross_return
       WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 hours')`,
    ).run();

    return json({ ok: true, count: players.length, home_tag: homeTag, holding_tag: holdingTag });
  }

  if (method === "GET" && subpath === "/rootmc/cross-return") {
    const auth = await authorizeCrossChat(env, request);
    if (auth instanceof Response) return auth;

    const url = new URL(request.url);
    const holdingTag = normalizeTag(str(url.searchParams.get("holding_tag")));
    const homeTag = normalizeTag(str(url.searchParams.get("home_tag")));
    if (!holdingTag) {
      return json({ detail: "holding_tag is required." }, 400);
    }

    let sql =
      `SELECT player_uuid, username, home_tag, holding_tag, created_at
       FROM g2_cross_return WHERE holding_tag = ?`;
    const binds: string[] = [holdingTag];
    if (homeTag) {
      sql += ` AND home_tag = ?`;
      binds.push(homeTag);
    }
    sql += ` ORDER BY created_at ASC LIMIT 100`;

    const rows = await env.DB.prepare(sql)
      .bind(...binds)
      .all<{
        player_uuid: string;
        username: string;
        home_tag: string;
        holding_tag: string;
        created_at: string;
      }>();

    const players = (rows.results || []).map((r) => ({
      uuid: r.player_uuid,
      username: r.username,
      home_tag: r.home_tag,
      holding_tag: r.holding_tag,
      created_at: r.created_at,
    }));

    return json({ ok: true, players });
  }

  if (method === "DELETE" && subpath === "/rootmc/cross-return") {
    const auth = await authorizeCrossChat(env, request);
    if (auth instanceof Response) return auth;

    let body: Record<string, unknown>;
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }

    const uuid = stripMcColors(str(body.uuid || body.player_uuid)).slice(0, 36);
    if (!uuid) {
      return json({ detail: "uuid is required." }, 400);
    }

    await env.DB.prepare(`DELETE FROM g2_cross_return WHERE player_uuid = ?`).bind(uuid).run();
    return json({ ok: true, uuid });
  }

  if (method === "POST" && subpath === "/rootmc/cross-presence") {
    const auth = await authorizeCrossChat(env, request);
    if (auth instanceof Response) return auth;

    let body: Record<string, unknown>;
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }

    const tag = normalizeTag(str(body.tag));
    const status = normalizeStatus(str(body.status));
    if (!tag || !status) {
      return json({ detail: "tag and status (online|offline) are required." }, 400);
    }

    await env.DB.prepare(
      `INSERT INTO g2_cross_presence (tag, status, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(tag) DO UPDATE SET
         status = excluded.status,
         updated_at = excluded.updated_at`,
    )
      .bind(tag, status)
      .run();

    return json({ ok: true, tag, status });
  }

  if (method === "GET" && subpath === "/rootmc/cross-presence") {
    const auth = await authorizeCrossChat(env, request);
    if (auth instanceof Response) return auth;

    const url = new URL(request.url);
    const excludeTag = normalizeTag(str(url.searchParams.get("exclude_tag")));

    let sql = `SELECT tag, status, updated_at FROM g2_cross_presence`;
    const binds: string[] = [];
    if (excludeTag) {
      sql += ` WHERE tag != ?`;
      binds.push(excludeTag);
    }
    sql += ` ORDER BY tag ASC`;

    const rows = await env.DB.prepare(sql)
      .bind(...binds)
      .all<{ tag: string; status: string; updated_at: string }>();

    const peers = (rows.results || []).map((r) => {
      const status = effectiveStatus(r.status, r.updated_at);
      return {
        tag: r.tag,
        status,
        updated_at: r.updated_at,
        stale: r.status === "online" && status === "offline",
      };
    });

    return json({ ok: true, peers });
  }

  if (method === "POST" && subpath === "/rootmc/cross-chat") {
    const auth = await authorizeCrossChat(env, request);
    if (auth instanceof Response) return auth;

    let body: Record<string, unknown>;
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }

    const tag = normalizeTag(str(body.tag));
    const username = stripMcColors(str(body.username)).slice(0, 32);
    const playerUuid = stripMcColors(str(body.uuid || body.player_uuid)).slice(0, 36);
    const message = stripMcColors(str(body.message)).slice(0, 256);
    if (!tag) {
      return json({ detail: "tag must be G1/G2 (or T/C/TOWNY/CLAIMS)." }, 400);
    }
    if (!username || !message) {
      return json({ detail: "username and message are required." }, 400);
    }

    const insert = await env.DB.prepare(
      `INSERT INTO g2_cross_chat (tag, username, player_uuid, message) VALUES (?, ?, ?, ?) RETURNING id`,
    )
      .bind(tag, username, playerUuid, message)
      .first<{ id: number }>();

    await env.DB.prepare(
      `DELETE FROM g2_cross_chat WHERE id < IFNULL((SELECT MAX(id) FROM g2_cross_chat), 0) - 500`,
    ).run();

    return json({ ok: true, id: insert?.id ?? null });
  }

  if (method === "GET" && subpath === "/rootmc/cross-chat/poll") {
    const auth = await authorizeCrossChat(env, request);
    if (auth instanceof Response) return auth;

    const url = new URL(request.url);
    const after = Math.max(0, Number(url.searchParams.get("after") || "0") || 0);
    const excludeTag = normalizeTag(str(url.searchParams.get("exclude_tag")));
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || "25") || 25));
    const prime = url.searchParams.get("prime") === "1" || url.searchParams.get("prime") === "true";

    if (prime) {
      const newest = await env.DB.prepare(
        `SELECT COALESCE(MAX(id), ?) AS newest_id FROM g2_cross_chat`,
      )
        .bind(after)
        .first<{ newest_id: number }>();
      return json({ ok: true, messages: [], newest_id: Number(newest?.newest_id) || after });
    }

    let sql =
      `SELECT id, tag, username, player_uuid, message, created_at FROM g2_cross_chat WHERE id > ?`;
    const binds: (string | number)[] = [after];
    if (excludeTag) {
      sql += ` AND tag != ?`;
      binds.push(excludeTag);
    }
    sql += ` ORDER BY id ASC LIMIT ?`;
    binds.push(limit);

    const rows = await env.DB.prepare(sql).bind(...binds).all<{
      id: number;
      tag: string;
      username: string;
      player_uuid: string;
      message: string;
      created_at: string;
    }>();

    const messages = (rows.results || []).map((r) => ({
      id: r.id,
      tag: r.tag,
      username: r.username,
      uuid: r.player_uuid,
      message: r.message,
      created_at: r.created_at,
    }));
    const newestId = messages.length ? messages[messages.length - 1].id : after;

    return json({ ok: true, messages, newest_id: newestId });
  }

  return json({ detail: "Not found." }, 404);
}
