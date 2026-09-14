/** Minimal Discord REST helpers for the RootMC bot token. */

import type { D1Database } from "@cloudflare/workers-types";

/** Gen 2 isolated dump channel — all api2 Discord posts land here (no Gen 1 migration). */
export const ROOTMC_G2_DISCORD_CHANNEL_ID = "1527451269252382890";

/** Discord MessageFlags.SUPPRESS_NOTIFICATIONS — silent post, no push/desktop ping. */
export const DISCORD_MSG_FLAG_SUPPRESS_NOTIFICATIONS = 1 << 12; // 4096

function isG2DumpChannelMessagePath(path: string): boolean {
  const p = String(path || "");
  if (!p.includes("/messages")) return false;
  return (
    p.includes(`/channels/${ROOTMC_G2_DISCORD_CHANNEL_ID}/`) ||
    p.includes(`/channels/${encodeURIComponent(ROOTMC_G2_DISCORD_CHANNEL_ID)}/`)
  );
}

function withSilentG2Payload(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    const payload = JSON.parse(body) as Record<string, unknown>;
    payload.flags = (Number(payload.flags) || 0) | DISCORD_MSG_FLAG_SUPPRESS_NOTIFICATIONS;
    const mentions =
      payload.allowed_mentions && typeof payload.allowed_mentions === "object"
        ? { ...(payload.allowed_mentions as Record<string, unknown>), parse: [] as string[] }
        : { parse: [] as string[] };
    payload.allowed_mentions = mentions;
    return JSON.stringify(payload);
  } catch {
    return body;
  }
}

function withSilentG2FormData(form: FormData): FormData {
  const raw = form.get("payload_json");
  if (typeof raw !== "string") return form;
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    payload.flags = (Number(payload.flags) || 0) | DISCORD_MSG_FLAG_SUPPRESS_NOTIFICATIONS;
    payload.allowed_mentions = { parse: [] };
    form.set("payload_json", JSON.stringify(payload));
  } catch {
    // leave form unchanged
  }
  return form;
}

export async function discordBotFetch(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  let nextInit = init;
  if (String(init.method || "GET").toUpperCase() === "POST" && isG2DumpChannelMessagePath(path) && init.body) {
    if (typeof init.body === "string") {
      nextInit = { ...init, body: withSilentG2Payload(init.body) as string };
    } else if (typeof FormData !== "undefined" && init.body instanceof FormData) {
      nextInit = { ...init, body: withSilentG2FormData(init.body) };
    }
  }
  const headers = new Headers(nextInit.headers);
  headers.set("Authorization", `Bot ${token.replace(/^bot\s+/i, "").trim()}`);
  if (nextInit.body && !headers.has("Content-Type") && !(typeof FormData !== "undefined" && nextInit.body instanceof FormData)) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  headers.set("User-Agent", "RootRecord/rootmc-discord-bot");
  return fetch(`https://discord.com/api/v10${path}`, { ...nextInit, headers });
}

export function discordChannelSlug(name: string, suffix?: string): string {
  let base = String(name || "channel")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!base) base = "channel";
  if (suffix) {
    const tail = String(suffix).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    if (tail) base = `${base}-${tail}`;
  }
  return base.slice(0, 100);
}

export async function createGuildTextChannel(
  token: string,
  guildId: string,
  name: string,
  parentId: string,
  topic: string,
): Promise<{ id: string } | null> {
  const res = await discordBotFetch(token, `/guilds/${encodeURIComponent(guildId)}/channels`, {
    method: "POST",
    body: JSON.stringify({
      name,
      type: 0,
      parent_id: parentId,
      topic: topic.slice(0, 1024),
    }),
  });
  if (!res.ok) {
    console.error("discord_create_channel_failed", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = (await res.json()) as { id?: string };
  return data.id ? { id: data.id } : null;
}

export async function patchChannel(
  token: string,
  channelId: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  const res = await discordBotFetch(token, `/channels/${encodeURIComponent(channelId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("discord_patch_channel_failed", channelId, res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}

export async function deleteGuildChannel(token: string, channelId: string): Promise<boolean> {
  const res = await discordBotFetch(token, `/channels/${encodeURIComponent(channelId)}`, {
    method: "DELETE",
  });
  if (res.ok || res.status === 404) {
    return true;
  }
  console.error("discord_delete_channel_failed", channelId, res.status, await res.text().catch(() => ""));
  return false;
}

export async function createChannelInvite(token: string, channelId: string): Promise<string | null> {
  const res = await discordBotFetch(token, `/channels/${encodeURIComponent(channelId)}/invites`, {
    method: "POST",
    body: JSON.stringify({ max_age: 0, max_uses: 0 }),
  });
  if (!res.ok) {
    console.error("discord_create_invite_failed", channelId, res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = (await res.json()) as { code?: string };
  return data.code ? `https://discord.gg/${data.code}` : null;
}

export async function sendDirectMessage(
  token: string,
  discordUserId: string,
  content: string,
): Promise<boolean> {
  const dmRes = await discordBotFetch(token, "/users/@me/channels", {
    method: "POST",
    body: JSON.stringify({ recipient_id: discordUserId }),
  });
  if (!dmRes.ok) return false;
  const dm = (await dmRes.json()) as { id?: string };
  if (!dm.id) return false;
  const msgRes = await discordBotFetch(token, `/channels/${encodeURIComponent(dm.id)}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: content.slice(0, 1900) }),
  });
  return msgRes.ok;
}

export async function setChannelPermissionOverwrite(
  token: string,
  channelId: string,
  targetId: string,
  allowMember: boolean,
): Promise<void> {
  await discordBotFetch(token, `/channels/${encodeURIComponent(channelId)}/permissions/${targetId}`, {
    method: "PUT",
    body: JSON.stringify(
      allowMember
        ? { id: targetId, type: 1, allow: "3072", deny: "0" }
        : { id: targetId, type: 0, deny: "1024", allow: "0" },
    ),
  });
}

/** Role overwrite  -  view + send + read history. */
export async function setRoleChannelPermission(
  token: string,
  channelId: string,
  roleId: string,
  allow = "68608",
): Promise<void> {
  await discordBotFetch(token, `/channels/${encodeURIComponent(channelId)}/permissions/${roleId}`, {
    method: "PUT",
    body: JSON.stringify({ id: roleId, type: 0, allow, deny: "0" }),
  });
}

export async function fetchDiscordChannel(
  token: string,
  channelId: string,
): Promise<{ id: string; type: number; guild_id?: string; name?: string } | null> {
  const res = await discordBotFetch(token, `/channels/${encodeURIComponent(channelId)}`);
  if (!res.ok) {
    console.error("discord_fetch_channel_failed", channelId, res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = (await res.json()) as { id?: string; type?: number; guild_id?: string; name?: string };
  return data.id ? { id: data.id, type: Number(data.type) || 0, guild_id: data.guild_id, name: data.name } : null;
}

export async function createForumPostThread(
  token: string,
  forumChannelId: string,
  threadName: string,
  message: { content?: string; embeds?: DiscordEmbed[] },
): Promise<{ id: string } | null> {
  const res = await discordBotFetch(token, `/channels/${encodeURIComponent(forumChannelId)}/threads`, {
    method: "POST",
    body: JSON.stringify({
      name: threadName.slice(0, 100),
      auto_archive_duration: 10080,
      message: {
        content: message.content?.slice(0, 2000) || undefined,
        embeds: message.embeds?.slice(0, 10),
      },
    }),
  });
  if (!res.ok) {
    console.error("discord_forum_thread_failed", forumChannelId, res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = (await res.json()) as { id?: string };
  return data.id ? { id: data.id } : null;
}

export async function createPublicThread(
  token: string,
  parentChannelId: string,
  threadName: string,
  message: { content?: string; embeds?: DiscordEmbed[] },
): Promise<{ id: string } | null> {
  const res = await discordBotFetch(token, `/channels/${encodeURIComponent(parentChannelId)}/threads`, {
    method: "POST",
    body: JSON.stringify({
      name: threadName.slice(0, 100),
      type: 11,
      auto_archive_duration: 10080,
      message: {
        content: message.content?.slice(0, 2000) || undefined,
        embeds: message.embeds?.slice(0, 10),
      },
    }),
  });
  if (!res.ok) {
    console.error("discord_public_thread_failed", parentChannelId, res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = (await res.json()) as { id?: string };
  return data.id ? { id: data.id } : null;
}

export async function createPrivateThread(
  token: string,
  parentChannelId: string,
  threadName: string,
  message: { content?: string; embeds?: DiscordEmbed[] },
): Promise<{ id: string } | null> {
  const res = await discordBotFetch(token, `/channels/${encodeURIComponent(parentChannelId)}/threads`, {
    method: "POST",
    body: JSON.stringify({
      name: threadName.slice(0, 100),
      type: 12,
      invitable: false,
      auto_archive_duration: 10080,
      message: {
        content: message.content?.slice(0, 2000) || undefined,
        embeds: message.embeds?.slice(0, 10),
      },
    }),
  });
  if (!res.ok) {
    console.error("discord_private_thread_failed", parentChannelId, res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = (await res.json()) as { id?: string };
  return data.id ? { id: data.id } : null;
}

export async function discordUserForMinecraftUuid(
  db: D1Database,
  mcUuid: string | null | undefined,
): Promise<string | null> {
  const uuid = String(mcUuid ?? "").trim().toLowerCase();
  if (!uuid) return null;
  const link = await db
    .prepare(
      `SELECT l.account_id
       FROM rootstat_minecraft_links l
       WHERE l.minecraft_uuid = ?
       LIMIT 1`,
    )
    .bind(uuid)
    .first<{ account_id: string }>();
  const accountId = String(link?.account_id ?? "").trim();
  if (!accountId) return null;
  const discord = await db
    .prepare(`SELECT discord_user_id FROM discord_account_links WHERE account_id = ? LIMIT 1`)
    .bind(accountId)
    .first<{ discord_user_id: string }>();
  const discordId = String(discord?.discord_user_id ?? "").trim();
  return discordId || null;
}

export async function lockChannelReadOnly(token: string, channelId: string, guildId: string): Promise<void> {
  await setChannelPermissionOverwrite(token, channelId, guildId, false);
  await patchChannel(token, channelId, {});
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

export async function sendChannelMessage(
  token: string,
  channelId: string,
  body: { content?: string; embeds?: DiscordEmbed[]; mentionUserIds?: string[]; silent?: boolean },
): Promise<string | null> {
  const silent = body.silent === true || channelId === ROOTMC_G2_DISCORD_CHANNEL_ID;
  const payload: Record<string, unknown> = {
    content: body.content?.slice(0, 1900) || undefined,
    embeds: body.embeds?.slice(0, 10),
  };
  if (silent) {
    payload.flags = DISCORD_MSG_FLAG_SUPPRESS_NOTIFICATIONS;
    payload.allowed_mentions = { parse: [] };
  } else if (body.mentionUserIds?.length) {
    payload.allowed_mentions = { users: body.mentionUserIds.slice(0, 25) };
  }
  const res = await discordBotFetch(token, `/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error("discord_send_channel_failed", channelId, res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = (await res.json()) as { id?: string };
  return data.id ? String(data.id) : null;
}

export async function fetchGuildSummary(
  token: string,
  guildId: string,
): Promise<{ memberCount: number; channelCount: number } | null> {
  const res = await discordBotFetch(token, `/guilds/${encodeURIComponent(guildId)}?with_counts=true`);
  if (!res.ok) return null;
  const data = (await res.json()) as { approximate_member_count?: number; channels?: unknown[] };
  return {
    memberCount: Number(data.approximate_member_count) || 0,
    channelCount: Array.isArray(data.channels) ? data.channels.length : 0,
  };
}

interface GuildChannelRow {
  id: string;
  name: string;
  type: number;
  position?: number;
  parent_id?: string | null;
}

export async function listGuildTextChannels(token: string, guildId: string): Promise<GuildChannelRow[]> {
  const res = await discordBotFetch(token, `/guilds/${encodeURIComponent(guildId)}/channels`);
  if (!res.ok) return [];
  const rows = (await res.json()) as GuildChannelRow[];
  return (rows || []).filter((c) => c.type === 0 || c.type === 5);
}

export async function listGuildChannels(token: string, guildId: string): Promise<GuildChannelRow[]> {
  const res = await discordBotFetch(token, `/guilds/${encodeURIComponent(guildId)}/channels`);
  if (!res.ok) return [];
  return ((await res.json()) as GuildChannelRow[]) || [];
}

export async function putChannelPermissionOverwrite(
  token: string,
  channelId: string,
  targetId: string,
  type: 0 | 1,
  allow: string,
  deny: string,
): Promise<boolean> {
  const res = await discordBotFetch(token, `/channels/${encodeURIComponent(channelId)}/permissions/${targetId}`, {
    method: "PUT",
    body: JSON.stringify({ id: targetId, type, allow, deny }),
  });
  if (!res.ok) {
    console.error(
      "discord_put_channel_perm_failed",
      channelId,
      targetId,
      res.status,
      await res.text().catch(() => ""),
    );
    return false;
  }
  return true;
}

export async function fetchBotUserId(token: string): Promise<string | null> {
  const res = await discordBotFetch(token, "/users/@me");
  if (!res.ok) return null;
  const data = (await res.json()) as { id?: string };
  return data.id ? String(data.id) : null;
}

export async function ensureGuildMember(
  token: string,
  guildId: string,
  userId: string,
  userOAuthAccessToken: string,
): Promise<boolean> {
  const res = await discordBotFetch(token, `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify({ access_token: userOAuthAccessToken }),
  });
  if (res.status === 201 || res.status === 204) return true;
  if (res.status === 404) return false;
  console.error("discord_ensure_guild_member_failed", res.status, await res.text().catch(() => ""));
  return false;
}

export async function patchGuildMemberNickname(
  token: string,
  guildId: string,
  userId: string,
  nick: string,
): Promise<boolean> {
  const trimmed = String(nick || "").trim().slice(0, 32);
  if (!trimmed) return false;
  const res = await discordBotFetch(token, `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({ nick: trimmed }),
  });
  if (res.ok) return true;
  console.error("discord_patch_member_nick_failed", res.status, await res.text().catch(() => ""));
  return false;
}

export async function addGuildMemberRole(
  token: string,
  guildId: string,
  userId: string,
  roleId: string,
): Promise<boolean> {
  const res = await discordBotFetch(
    token,
    `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`,
    { method: "PUT" },
  );
  if (res.status === 204) return true;
  console.error("discord_add_member_role_failed", res.status, await res.text().catch(() => ""));
  return false;
}

export async function removeGuildMemberRole(
  token: string,
  guildId: string,
  userId: string,
  roleId: string,
): Promise<boolean> {
  const res = await discordBotFetch(
    token,
    `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`,
    { method: "DELETE" },
  );
  if (res.status === 204 || res.status === 404) return true;
  console.error("discord_remove_member_role_failed", res.status, await res.text().catch(() => ""));
  return false;
}

export async function findGuildRoleIdByName(
  token: string,
  guildId: string,
  roleName: string,
): Promise<string | null> {
  const res = await discordBotFetch(token, `/guilds/${encodeURIComponent(guildId)}/roles`);
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ id?: string; name?: string }>;
  const hit = (rows || []).find((r) => String(r.name || "") === roleName);
  return hit?.id ? String(hit.id) : null;
}
