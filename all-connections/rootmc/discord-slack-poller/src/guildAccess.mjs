/**
 * Discord permission bits Ava needs (lead-dev notes: ban/mute/kick + home channel + chat).
 * She prefers Administrator; falls back to this checklist.
 */

export const PERM = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  MODERATE_MEMBERS: 1n << 40n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  MANAGE_THREADS: 1n << 34n,
};

const LABELS = {
  ADMINISTRATOR: "Administrator",
  MANAGE_GUILD: "Manage Server",
  MANAGE_CHANNELS: "Manage Channels",
  MANAGE_ROLES: "Manage Roles",
  VIEW_AUDIT_LOG: "View Audit Log",
  KICK_MEMBERS: "Kick Members",
  BAN_MEMBERS: "Ban Members",
  MODERATE_MEMBERS: "Timeout Members",
  MANAGE_MESSAGES: "Manage Messages",
  MANAGE_NICKNAMES: "Manage Nicknames",
  VIEW_CHANNEL: "View Channels",
  SEND_MESSAGES: "Send Messages",
  EMBED_LINKS: "Embed Links",
  ATTACH_FILES: "Attach Files",
  READ_MESSAGE_HISTORY: "Read Message History",
  ADD_REACTIONS: "Add Reactions",
  USE_APPLICATION_COMMANDS: "Use App Commands",
  CREATE_PUBLIC_THREADS: "Create Public Threads",
  SEND_MESSAGES_IN_THREADS: "Send in Threads",
  MANAGE_THREADS: "Manage Threads",
};

/** Minimum ops set if not full Administrator */
export const AVA_REQUIRED_PERMS = [
  "VIEW_CHANNEL",
  "SEND_MESSAGES",
  "EMBED_LINKS",
  "ATTACH_FILES",
  "READ_MESSAGE_HISTORY",
  "ADD_REACTIONS",
  "USE_APPLICATION_COMMANDS",
  "MANAGE_CHANNELS",
  "MANAGE_MESSAGES",
  "KICK_MEMBERS",
  "BAN_MEMBERS",
  "MODERATE_MEMBERS",
  "VIEW_AUDIT_LOG",
  "CREATE_PUBLIC_THREADS",
  "SEND_MESSAGES_IN_THREADS",
];

/** Preferred: Administrator covers the notes (owner-presence moderation). */
export const AVA_PREFERRED_ADMIN = true;

export function inviteUrlForAdmin(clientId = "1532751879875072070") {
  // Administrator bit — Discord invite UI shows the Admin checkbox
  const permissions = String(PERM.ADMINISTRATOR);
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&integration_type=0&scope=bot%20applications.commands`;
}

export function inviteUrlForRequired(clientId = "1532751879875072070") {
  let bits = 0n;
  for (const key of AVA_REQUIRED_PERMS) bits |= PERM[key];
  // Also OR Administrator so one-click grant is offered
  bits |= PERM.ADMINISTRATOR;
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${bits.toString()}&integration_type=0&scope=bot%20applications.commands`;
}

function hasBit(perms, bit) {
  return (BigInt(perms) & bit) === bit;
}

export function summarizePerms(permsBig) {
  const p = BigInt(permsBig || 0);
  const hasAdmin = hasBit(p, PERM.ADMINISTRATOR);
  const have = [];
  const missing = [];
  for (const key of AVA_REQUIRED_PERMS) {
    const ok = hasAdmin || hasBit(p, PERM[key]);
    (ok ? have : missing).push(LABELS[key] || key);
  }
  return {
    raw: p.toString(),
    administrator: hasAdmin,
    have,
    missing,
    ok: hasAdmin || missing.length === 0,
  };
}

/**
 * Resolve bot permission bitfield in a guild (role union + @everyone).
 */
export async function inspectBotPermissions({
  fetchJson,
  guildId,
  botUserId,
  avaBotId,
}) {
  const userId = botUserId || avaBotId;
  if (!userId) throw new Error("inspectBotPermissions: missing botUserId");
  const [guild, member, roles] = await Promise.all([
    fetchJson(`/guilds/${guildId}?with_counts=true`),
    fetchJson(`/guilds/${guildId}/members/${userId}`),
    fetchJson(`/guilds/${guildId}/roles`),
  ]);

  const roleMap = new Map((roles || []).map((r) => [r.id, r]));
  const everyone = roleMap.get(guildId);
  let perms = BigInt(everyone?.permissions || 0);

  for (const roleId of member?.roles || []) {
    const role = roleMap.get(roleId);
    if (role?.permissions != null) perms |= BigInt(role.permissions);
  }

  const summary = summarizePerms(perms);

  const settings = {
    name: guild?.name,
    ownerId: guild?.owner_id,
    verificationLevel: guild?.verification_level,
    explicitContentFilter: guild?.explicit_content_filter,
    defaultMessageNotifications: guild?.default_message_notifications,
    mfaLevel: guild?.mfa_level,
    nsfwLevel: guild?.nsfw_level,
    premiumTier: guild?.premium_tier,
    features: guild?.features || [],
    preferredLocale: guild?.preferred_locale,
    memberCount: guild?.approximate_member_count || guild?.member_count || null,
  };

  return {
    permissions: perms.toString(),
    summary,
    settings,
    roleIds: member?.roles || [],
    nick: member?.nick || null,
  };
}

/** Soft ask — lives in #ava-ivy. No rush, no lecture. */
export function buildAdminRequestMessage(access, { clientId } = {}) {
  const url = inviteUrlForRequired(clientId);
  if (access?.summary?.ok) {
    return null;
  }

  return [
    `hey admins — i don't have the access i need yet.`,
    `when **Administrator** (or the mod/channel stuff) is available plz reply / grant — no rush.`,
    url,
    `or just bump my role when you can. i'll be here.`,
  ].join("\n");
}
