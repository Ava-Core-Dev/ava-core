import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import type { AuthEnv } from "./primary-auth";
import {
  FREE_GROUP_LIMIT,
  PRO_GROUP_LIMIT,
  isFriend,
  isGroupMember,
  maxOwnedGroups,
  normalizeFriendPair,
  profileByAccountId,
  publicProfilePayload,
  record,
  recordArray,
  requireSignedInAccount,
  resolveProfileLookup,
  sanitizeRealmUsername,
  sharedWorldsForAccount,
  str,
} from "./realm-lib";

type RealmEnv = AuthEnv;

async function upsertProfile(
  db: D1Database,
  accountId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const existing = await profileByAccountId(db, accountId);
  let realmUsername: string | null = existing?.realm_username ? str(existing.realm_username) : null;

  if ("realm_username" in body) {
    const candidate = sanitizeRealmUsername(body.realm_username);
    if (body.realm_username != null && String(body.realm_username).trim() && !candidate) {
      throw new Error("Realm username must be 3-20 characters: letters, numbers, underscore only.");
    }
    if (candidate) {
      const taken = await db
        .prepare(
          "SELECT account_id FROM rootmc_player_profiles WHERE realm_username = ? COLLATE NOCASE AND account_id != ? LIMIT 1",
        )
        .bind(candidate, accountId)
        .first<{ account_id: string }>();
      if (taken) throw new Error("That Realm username is already taken.");
      realmUsername = candidate;
    } else {
      realmUsername = null;
    }
  }

  const minecraftUsername = "minecraft_username" in body ? str(body.minecraft_username) || null : str(existing?.minecraft_username) || null;
  const minecraftUuid = "minecraft_uuid" in body ? str(body.minecraft_uuid) || null : str(existing?.minecraft_uuid) || null;
  const skinUrl = "skin_url" in body ? str(body.skin_url) || null : str(existing?.skin_url) || null;
  const bio = "bio" in body ? str(body.bio).slice(0, 280) || null : str(existing?.bio) || null;
  const publicProfile =
    "public_profile" in body ? (body.public_profile === false ? 0 : 1) : Number(existing?.public_profile ?? 1);

  if (existing) {
    await db
      .prepare(
        `UPDATE rootmc_player_profiles
         SET realm_username = ?, minecraft_username = ?, minecraft_uuid = ?, skin_url = ?, bio = ?,
             public_profile = ?, updated_at = ?
         WHERE account_id = ?`,
      )
      .bind(realmUsername, minecraftUsername, minecraftUuid, skinUrl, bio, publicProfile, now, accountId)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO rootmc_player_profiles
         (account_id, realm_username, minecraft_username, minecraft_uuid, skin_url, bio, public_profile, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(accountId, realmUsername, minecraftUsername, minecraftUuid, skinUrl, bio, publicProfile, now, now)
      .run();
  }

  if (Array.isArray(body.shared_worlds)) {
    await db.prepare("DELETE FROM rootmc_shared_worlds WHERE account_id = ?").bind(accountId).run();
    const worlds = recordArray(body.shared_worlds).slice(0, 24);
    for (let i = 0; i < worlds.length; i++) {
      const w = worlds[i];
      const worldKey = str(w.world_key).slice(0, 128);
      const worldName = str(w.world_name).slice(0, 120);
      if (!worldKey || !worldName) continue;
      await db
        .prepare(
          `INSERT INTO rootmc_shared_worlds
           (id, account_id, world_key, world_name, game_version, seed, note_count, is_public, sort_order, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          accountId,
          worldKey,
          worldName,
          str(w.game_version) || null,
          str(w.seed) || null,
          Math.max(0, Math.floor(Number(w.note_count || 0))),
          w.is_public === false ? 0 : 1,
          i,
          now,
        )
        .run();
    }
  }

  const row = await profileByAccountId(db, accountId);
  const worlds = await sharedWorldsForAccount(db, accountId);
  return publicProfilePayload(row || { account_id: accountId }, worlds);
}

async function searchUsers(db: D1Database, query: string, selfId: string) {
  const q = query.trim().slice(0, 32);
  if (q.length < 2) return [];
  const { results } = await db
    .prepare(
      `SELECT account_id, realm_username, minecraft_username, minecraft_uuid, skin_url
       FROM rootmc_player_profiles
       WHERE realm_username IS NOT NULL
         AND realm_username != ''
         AND realm_username LIKE ? ESCAPE '\\'
         AND account_id != ?
       ORDER BY realm_username ASC
       LIMIT 20`,
    )
    .bind(`${q.replace(/[%_\\]/g, "\\$&")}%`, selfId)
    .all<Record<string, unknown>>();
  return (results || []).map((r) => ({
    account_id: r.account_id,
    realm_username: r.realm_username,
    minecraft_username: r.minecraft_username || null,
    avatar_url: r.minecraft_uuid
      ? `https://crafatar.com/avatars/${String(r.minecraft_uuid).replace(/-/g, "")}?overlay&size=64`
      : null,
  }));
}

async function listFriends(db: D1Database, accountId: string) {
  const { results } = await db
    .prepare(
      `SELECT f.account_id_a, f.account_id_b, f.created_at,
              p.account_id, p.realm_username, p.minecraft_username, p.minecraft_uuid
       FROM rootmc_friendships f
       LEFT JOIN rootmc_player_profiles p ON p.account_id = CASE
         WHEN f.account_id_a = ? THEN f.account_id_b ELSE f.account_id_a END
       WHERE f.account_id_a = ? OR f.account_id_b = ?`,
    )
    .bind(accountId, accountId, accountId)
    .all<Record<string, unknown>>();
  return (results || []).map((r) => ({
    account_id: r.account_id_a === accountId ? r.account_id_b : r.account_id_a,
    realm_username: r.realm_username || null,
    minecraft_username: r.minecraft_username || null,
    friends_since: r.created_at,
    avatar_url: r.minecraft_uuid
      ? `https://crafatar.com/avatars/${String(r.minecraft_uuid).replace(/-/g, "")}?overlay&size=64`
      : null,
  }));
}

export async function handleRootMcRealm(
  request: Request,
  env: RealmEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  // Public player profile (web + future RootMC)
  if (method === "GET" && subpath.startsWith("/public/player/")) {
    const idOrUser = decodeURIComponent(subpath.slice("/public/player/".length)).trim();
    if (!idOrUser) return json({ detail: "Player id required." }, 400);
    const row = await resolveProfileLookup(env.DB, idOrUser);
    if (!row) return json({ detail: "Player not found." }, 404);
    if (Number(row.public_profile) === 0) return json({ detail: "Profile is private." }, 404);
    const worlds = await sharedWorldsForAccount(env.DB, str(row.account_id));
    return json({ player: publicProfilePayload(row, worlds) });
  }

  if (!subpath.startsWith("/rootmc/realm")) return null;
  const rest = subpath.slice("/rootmc/realm".length) || "/";

  if (method === "GET" && rest === "/profile/me") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    const row = await profileByAccountId(env.DB, auth.accountId);
    const worlds = await sharedWorldsForAccount(env.DB, auth.accountId);
    const maxGroups = await maxOwnedGroups(env.DB, auth.email);
    return json({
      profile: row ? publicProfilePayload(row, worlds) : null,
      group_limits: { owned_max: maxGroups, free: FREE_GROUP_LIMIT, pro: PRO_GROUP_LIMIT },
    });
  }

  if (method === "PUT" && rest === "/profile/me") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ detail: "Invalid JSON" }, 400);
    }
    try {
      const profile = await upsertProfile(env.DB, auth.accountId, body);
      return json({ ok: true, profile });
    } catch (e) {
      return json({ detail: e instanceof Error ? e.message : String(e) }, 400);
    }
  }

  if (method === "GET" && rest === "/users/search") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    const q = new URL(request.url).searchParams.get("q") || "";
    const users = await searchUsers(env.DB, q, auth.accountId);
    return json({ users });
  }

  if (method === "GET" && rest === "/friends") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    const friends = await listFriends(env.DB, auth.accountId);
    return json({ friends });
  }

  if (method === "GET" && rest === "/friends/requests") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    const { results: incoming } = await env.DB.prepare(
      `SELECT r.*, p.realm_username, p.minecraft_username
       FROM rootmc_friend_requests r
       LEFT JOIN rootmc_player_profiles p ON p.account_id = r.from_account_id
       WHERE r.to_account_id = ? AND r.status = 'pending'
       ORDER BY r.created_at DESC`,
    )
      .bind(auth.accountId)
      .all<Record<string, unknown>>();
    const { results: outgoing } = await env.DB.prepare(
      `SELECT r.*, p.realm_username
       FROM rootmc_friend_requests r
       LEFT JOIN rootmc_player_profiles p ON p.account_id = r.to_account_id
       WHERE r.from_account_id = ? AND r.status = 'pending'
       ORDER BY r.created_at DESC`,
    )
      .bind(auth.accountId)
      .all<Record<string, unknown>>();
    return json({ incoming: incoming || [], outgoing: outgoing || [] });
  }

  if (method === "POST" && rest === "/friends/request") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    let body: { realm_username?: string; account_id?: string; message?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON" }, 400);
    }
    let targetId = str(body.account_id);
    if (!targetId && body.realm_username) {
      const target = await resolveProfileLookup(env.DB, str(body.realm_username));
      targetId = str(target?.account_id);
    }
    if (!targetId) return json({ detail: "User not found. They need a Realm username first." }, 404);
    if (targetId === auth.accountId) return json({ detail: "You cannot friend yourself." }, 400);
    if (await isFriend(env.DB, auth.accountId, targetId)) {
      return json({ detail: "Already friends." }, 409);
    }
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare(
        `INSERT INTO rootmc_friend_requests (id, from_account_id, to_account_id, status, message, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
      )
        .bind(id, auth.accountId, targetId, str(body.message).slice(0, 200) || null, now, now)
        .run();
    } catch {
      return json({ detail: "Friend request already sent." }, 409);
    }
    return json({ ok: true, request_id: id });
  }

  if (method === "POST" && rest === "/friends/respond") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    let body: { request_id?: string; action?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON" }, 400);
    }
    const requestId = str(body.request_id);
    const action = str(body.action).toLowerCase();
    if (!requestId || !["accept", "decline"].includes(action)) {
      return json({ detail: "request_id and action (accept|decline) required." }, 400);
    }
    const row = await env.DB.prepare("SELECT * FROM rootmc_friend_requests WHERE id = ? LIMIT 1")
      .bind(requestId)
      .first<Record<string, unknown>>();
    if (!row || str(row.to_account_id) !== auth.accountId || str(row.status) !== "pending") {
      return json({ detail: "Request not found." }, 404);
    }
    const now = new Date().toISOString();
    const status = action === "accept" ? "accepted" : "declined";
    await env.DB.prepare("UPDATE rootmc_friend_requests SET status = ?, updated_at = ? WHERE id = ?")
      .bind(status, now, requestId)
      .run();
    if (action === "accept") {
      const [a, b] = normalizeFriendPair(str(row.from_account_id), str(row.to_account_id));
      await env.DB.prepare(
        "INSERT OR IGNORE INTO rootmc_friendships (account_id_a, account_id_b, created_at) VALUES (?, ?, ?)",
      )
        .bind(a, b, now)
        .run();
    }
    return json({ ok: true, status });
  }

  if (method === "GET" && rest === "/groups") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    const { results } = await env.DB.prepare(
      `SELECT g.*, m.role
       FROM rootmc_groups g
       INNER JOIN rootmc_group_members m ON m.group_id = g.id
       WHERE m.account_id = ?
       ORDER BY g.updated_at DESC`,
    )
      .bind(auth.accountId)
      .all<Record<string, unknown>>();
    const maxGroups = await maxOwnedGroups(env.DB, auth.email);
    const owned = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM rootmc_groups WHERE owner_account_id = ?",
    )
      .bind(auth.accountId)
      .first<{ count: number }>();
    return json({
      groups: results || [],
      owned_count: Number(owned?.count || 0),
      owned_max: maxGroups,
    });
  }

  if (method === "POST" && rest === "/groups") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    let body: { name?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON" }, 400);
    }
    const name = str(body.name).slice(0, 64);
    if (name.length < 2) return json({ detail: "Group name must be at least 2 characters." }, 400);
    const maxGroups = await maxOwnedGroups(env.DB, auth.email);
    const owned = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM rootmc_groups WHERE owner_account_id = ?",
    )
      .bind(auth.accountId)
      .first<{ count: number }>();
    if (Number(owned?.count || 0) >= maxGroups) {
      return json(
        {
          detail: "group_limit_reached",
          message: `Free accounts can own ${FREE_GROUP_LIMIT} group. Pro/Lifetime can own ${PRO_GROUP_LIMIT}.`,
          owned_max: maxGroups,
        },
        429,
      );
    }
    const now = new Date().toISOString();
    const groupId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO rootmc_groups (id, owner_account_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(groupId, auth.accountId, name, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO rootmc_group_members (group_id, account_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
    )
      .bind(groupId, auth.accountId, now)
      .run();
    return json({ ok: true, group: { id: groupId, name, owner_account_id: auth.accountId, role: "owner" } });
  }

  const groupInviteMatch = rest.match(/^\/groups\/([^/]+)\/invite$/);
  if (method === "POST" && groupInviteMatch) {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    const groupId = groupInviteMatch[1];
    if (!(await isGroupMember(env.DB, groupId, auth.accountId))) {
      return json({ detail: "Not a group member." }, 403);
    }
    let body: { realm_username?: string; account_id?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON" }, 400);
    }
    let inviteeId = str(body.account_id);
    if (!inviteeId && body.realm_username) {
      const target = await resolveProfileLookup(env.DB, str(body.realm_username));
      inviteeId = str(target?.account_id);
    }
    if (!inviteeId) return json({ detail: "User not found." }, 404);
    if (await isGroupMember(env.DB, groupId, inviteeId)) {
      return json({ detail: "User is already in the group." }, 409);
    }
    const now = new Date().toISOString();
    const inviteId = crypto.randomUUID();
    try {
      await env.DB.prepare(
        `INSERT INTO rootmc_group_invites (id, group_id, inviter_account_id, invitee_account_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
        .bind(inviteId, groupId, auth.accountId, inviteeId, now, now)
        .run();
    } catch {
      return json({ detail: "Invite already pending." }, 409);
    }
    return json({ ok: true, invite_id: inviteId });
  }

  if (method === "POST" && rest === "/groups/invites/respond") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    let body: { invite_id?: string; action?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON" }, 400);
    }
    const inviteId = str(body.invite_id);
    const action = str(body.action).toLowerCase();
    if (!inviteId || !["accept", "decline"].includes(action)) {
      return json({ detail: "invite_id and action required." }, 400);
    }
    const row = await env.DB.prepare("SELECT * FROM rootmc_group_invites WHERE id = ? LIMIT 1")
      .bind(inviteId)
      .first<Record<string, unknown>>();
    if (!row || str(row.invitee_account_id) !== auth.accountId || str(row.status) !== "pending") {
      return json({ detail: "Invite not found." }, 404);
    }
    const now = new Date().toISOString();
    const status = action === "accept" ? "accepted" : "declined";
    await env.DB.prepare("UPDATE rootmc_group_invites SET status = ?, updated_at = ? WHERE id = ?")
      .bind(status, now, inviteId)
      .run();
    if (action === "accept") {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO rootmc_group_members (group_id, account_id, role, joined_at) VALUES (?, ?, 'member', ?)",
      )
        .bind(str(row.group_id), auth.accountId, now)
        .run();
      await env.DB.prepare("UPDATE rootmc_groups SET updated_at = ? WHERE id = ?")
        .bind(now, str(row.group_id))
        .run();
    }
    return json({ ok: true, status, group_id: row.group_id });
  }

  const chambersMatch = rest.match(/^\/groups\/([^/]+)\/chambers$/);
  if (chambersMatch) {
    const groupId = chambersMatch[1];
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    if (!(await isGroupMember(env.DB, groupId, auth.accountId))) {
      return json({ detail: "Not a group member." }, 403);
    }

    if (method === "GET") {
      const row = await env.DB.prepare(
        "SELECT snapshot_json, updated_at FROM rootmc_group_chambers WHERE group_id = ? LIMIT 1",
      )
        .bind(groupId)
        .first<{ snapshot_json: string; updated_at: number }>();
      if (!row?.snapshot_json) {
        return json({ snapshot: null, updated_at: 0 });
      }
      let snapshot: unknown = null;
      try {
        snapshot = JSON.parse(row.snapshot_json);
      } catch {
        return json({ detail: "Corrupt chamber snapshot." }, 500);
      }
      return json({ snapshot, updated_at: Number(row.updated_at || 0) });
    }

    if (method === "PUT") {
      let body: { snapshot?: unknown } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ detail: "Invalid JSON" }, 400);
      }
      if (!body.snapshot || typeof body.snapshot !== "object") {
        return json({ detail: "snapshot object required." }, 400);
      }
      const now = Date.now();
      const snapshotJson = JSON.stringify(body.snapshot);
      if (snapshotJson.length > 512_000) {
        return json({ detail: "Chamber snapshot too large." }, 413);
      }
      await env.DB.prepare(
        `INSERT INTO rootmc_group_chambers (group_id, snapshot_json, updated_at, updated_by_account_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(group_id) DO UPDATE SET
           snapshot_json = excluded.snapshot_json,
           updated_at = excluded.updated_at,
           updated_by_account_id = excluded.updated_by_account_id`,
      )
        .bind(groupId, snapshotJson, now, auth.accountId)
        .run();
      await env.DB.prepare("UPDATE rootmc_groups SET updated_at = ? WHERE id = ?")
        .bind(new Date(now).toISOString(), groupId)
        .run();
      return json({ ok: true, updated_at: now });
    }
  }

  const messagesMatch = rest.match(/^\/groups\/([^/]+)\/messages$/);
  if (messagesMatch) {
    const groupId = messagesMatch[1];
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    if (!(await isGroupMember(env.DB, groupId, auth.accountId))) {
      return json({ detail: "Not a group member." }, 403);
    }

    if (method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT m.*, p.realm_username, p.minecraft_username
         FROM rootmc_group_messages m
         LEFT JOIN rootmc_player_profiles p ON p.account_id = m.sender_account_id
         WHERE m.group_id = ?
         ORDER BY m.created_at DESC LIMIT 80`,
      )
        .bind(groupId)
        .all<Record<string, unknown>>();
      return json({ messages: (results || []).reverse() });
    }

    if (method === "POST") {
      let body: { body?: string } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ detail: "Invalid JSON" }, 400);
      }
      const text = str(body.body).slice(0, 2000);
      if (!text) return json({ detail: "Message body required." }, 400);
      const now = new Date().toISOString();
      const msgId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO rootmc_group_messages (id, group_id, sender_account_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(msgId, groupId, auth.accountId, text, now)
        .run();
      await env.DB.prepare("UPDATE rootmc_groups SET updated_at = ? WHERE id = ?").bind(now, groupId).run();
      return json({ ok: true, message: { id: msgId, body: text, created_at: now, sender_account_id: auth.accountId } });
    }
  }

  if (method === "GET" && rest === "/groups/invites") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    const { results } = await env.DB.prepare(
      `SELECT i.*, g.name AS group_name, p.realm_username AS inviter_username
       FROM rootmc_group_invites i
       INNER JOIN rootmc_groups g ON g.id = i.group_id
       LEFT JOIN rootmc_player_profiles p ON p.account_id = i.inviter_account_id
       WHERE i.invitee_account_id = ? AND i.status = 'pending'
       ORDER BY i.created_at DESC`,
    )
      .bind(auth.accountId)
      .all<Record<string, unknown>>();
    return json({ invites: results || [] });
  }

  return null;
}
