/**
 * RootMC Discord: @everyone can read public channels but only linked MC players may speak.
 * Run scripts/discord-apply-rootmc-chat-locks.mjs after guild layout changes.
 */
import {
  discordBotFetch,
  fetchBotUserId,
  listGuildChannels,
  putChannelPermissionOverwrite,
} from "./discord-rootmc-api";

const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const READ_HISTORY = 1n << 16n;
const CONNECT = 1n << 20n;
const SPEAK = 1n << 21n;
const ATTACH_FILES = 1n << 15n;
const USE_APP_CMD = 1n << 31n;
const CREATE_PUB_THREAD = 1n << 35n;
const CREATE_PRIV_THREAD = 1n << 36n;
const SEND_IN_THREAD = 1n << 38n;

function perm(...bits: bigint[]): string {
  return bits.reduce((a, b) => a | b, 0n).toString();
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

export type LinkedChatLockEnv = {
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_GUILD_ID?: string;
  DISCORD_ROOTMC_LINKED_ROLE_ID?: string;
  DISCORD_ROOTMC_STAFF_ROLE_ID?: string;
  DISCORD_ROOTMC_RULES_CHANNEL_ID?: string;
  DISCORD_ROOTMC_ADMINS_CHANNEL_ID?: string;
  DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID?: string;
  DISCORD_ROOTMC_BOT_SPAM_CHANNEL_ID?: string;
  DISCORD_ROOTMC_AI_ARCHIVE_CHANNEL_ID?: string;
  DISCORD_ROOTMC_OPERATIONS_FORUM_CHANNEL_ID?: string;
  DISCORD_ROOTMC_APPEALS_FORUM_CHANNEL_ID?: string;
  DISCORD_ROOTMC_REPORT_TICKETS_CATEGORY_ID?: string;
  DISCORD_ROOTMC_TOWN_CATEGORY_ID?: string;
  DISCORD_ROOTMC_NATION_CATEGORY_ID?: string;
  DISCORD_ROOTMC_TOWN_ARCHIVE_CATEGORY_ID?: string;
  DISCORD_ROOTMC_NATION_ARCHIVE_CATEGORY_ID?: string;
};

type GuildChannelRow = {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
  topic?: string;
};

type ChannelPolicy = "skip" | "rules_readonly" | "staff_only" | "linked_speak";

function isTextLike(type: number): boolean {
  return type === 0 || type === 5 || type === 15 || type === 12;
}

function isVoiceLike(type: number): boolean {
  return type === 2 || type === 13;
}

function channelById(channels: GuildChannelRow[]): Map<string, GuildChannelRow> {
  return new Map(channels.map((c) => [String(c.id), c]));
}

function isUnderCategory(ch: GuildChannelRow, categoryId: string, byId: Map<string, GuildChannelRow>): boolean {
  if (!categoryId) return false;
  let parent = ch.parent_id ? byId.get(String(ch.parent_id)) : undefined;
  while (parent) {
    if (String(parent.id) === categoryId) return true;
    parent = parent.parent_id ? byId.get(String(parent.parent_id)) : undefined;
  }
  return String(ch.id) === categoryId;
}

function isTownNationManaged(ch: GuildChannelRow, env: LinkedChatLockEnv, byId: Map<string, GuildChannelRow>): boolean {
  const cats = [
    env.DISCORD_ROOTMC_TOWN_CATEGORY_ID,
    env.DISCORD_ROOTMC_NATION_CATEGORY_ID,
    env.DISCORD_ROOTMC_TOWN_ARCHIVE_CATEGORY_ID,
    env.DISCORD_ROOTMC_NATION_ARCHIVE_CATEGORY_ID,
    env.DISCORD_ROOTMC_REPORT_TICKETS_CATEGORY_ID,
  ];
  return cats.some((id) => isUnderCategory(ch, str(id), byId));
}

function resolveChannelPolicy(ch: GuildChannelRow, env: LinkedChatLockEnv, byId: Map<string, GuildChannelRow>): ChannelPolicy {
  if (ch.type === 4) return "skip";
  if (isTownNationManaged(ch, env, byId)) return "skip";

  const id = String(ch.id);
  const staffIds = new Set(
    [
      env.DISCORD_ROOTMC_ADMINS_CHANNEL_ID,
      env.DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID,
      env.DISCORD_ROOTMC_BOT_SPAM_CHANNEL_ID,
      env.DISCORD_ROOTMC_AI_ARCHIVE_CHANNEL_ID,
      env.DISCORD_ROOTMC_OPERATIONS_FORUM_CHANNEL_ID,
      env.DISCORD_ROOTMC_APPEALS_FORUM_CHANNEL_ID,
    ]
      .map(str)
      .filter(Boolean),
  );
  if (staffIds.has(id)) return "staff_only";
  if (id === str(env.DISCORD_ROOTMC_RULES_CHANNEL_ID)) return "rules_readonly";

  const name = String(ch.name || "").toLowerCase();
  const topic = String(ch.topic || "").toLowerCase();
  const hay = `${name} ${topic}`;
  if (/\badmin\b|\bmoderators?\b|\bstaff-?only\b|\binternal\b|\baudit\b|\bbot-?spam\b/.test(hay)) {
    return "staff_only";
  }

  return "linked_speak";
}

export async function applyLinkedChatLockToChannel(
  token: string,
  guildId: string,
  channelId: string,
  linkedRoleId: string,
  opts?: { staffRoleId?: string; botUserId?: string; policy?: ChannelPolicy },
): Promise<boolean> {
  const linked = str(linkedRoleId);
  if (!linked) return false;

  const chRes = await discordBotFetch(token, `/channels/${encodeURIComponent(channelId)}`);
  if (!chRes.ok) return false;
  const ch = (await chRes.json()) as GuildChannelRow;
  const policy = opts?.policy || "linked_speak";
  if (policy === "skip") return true;

  const staffRoleId = str(opts?.staffRoleId);
  const botUserId = str(opts?.botUserId);
  const linkedText = perm(
    VIEW,
    READ_HISTORY,
    SEND,
    USE_APP_CMD,
    ATTACH_FILES,
    CREATE_PUB_THREAD,
    CREATE_PRIV_THREAD,
    SEND_IN_THREAD,
  );
  const botText = perm(VIEW, READ_HISTORY, SEND);
  const botVoice = perm(VIEW, CONNECT, SPEAK);

  if (policy === "rules_readonly") {
    if (!isTextLike(ch.type)) return true;
    const everyoneRead = perm(VIEW, READ_HISTORY);
    const noSend = perm(SEND, SEND_IN_THREAD, CREATE_PUB_THREAD, CREATE_PRIV_THREAD, ATTACH_FILES);
    await putChannelPermissionOverwrite(token, channelId, guildId, 0, everyoneRead, noSend);
    if (staffRoleId) {
      await putChannelPermissionOverwrite(token, channelId, staffRoleId, 0, linkedText, "0");
    }
    if (botUserId) {
      await putChannelPermissionOverwrite(token, channelId, botUserId, 1, botText, "0");
    }
    return true;
  }

  if (policy === "staff_only") {
    const hide = perm(VIEW, SEND, CONNECT, SPEAK);
    await putChannelPermissionOverwrite(token, channelId, guildId, 0, "0", hide);
    if (staffRoleId) {
      const staffText = isVoiceLike(ch.type)
        ? perm(VIEW, CONNECT, SPEAK, READ_HISTORY)
        : linkedText;
      await putChannelPermissionOverwrite(token, channelId, staffRoleId, 0, staffText, "0");
    }
    if (botUserId) {
      const botAllow = isVoiceLike(ch.type) ? botVoice : botText;
      await putChannelPermissionOverwrite(token, channelId, botUserId, 1, botAllow, "0");
    }
    return true;
  }

  // linked_speak  -  read for all, speak for linked (+ staff)
  if (isTextLike(ch.type)) {
    const everyoneRead = perm(VIEW, READ_HISTORY, USE_APP_CMD);
    const noSend = perm(SEND, SEND_IN_THREAD, CREATE_PUB_THREAD, CREATE_PRIV_THREAD, ATTACH_FILES);
    await putChannelPermissionOverwrite(token, channelId, guildId, 0, everyoneRead, noSend);
    await putChannelPermissionOverwrite(token, channelId, linked, 0, linkedText, "0");
    if (staffRoleId && staffRoleId !== linked) {
      await putChannelPermissionOverwrite(token, channelId, staffRoleId, 0, linkedText, "0");
    }
    if (botUserId) {
      await putChannelPermissionOverwrite(token, channelId, botUserId, 1, botText, "0");
    }
    return true;
  }

  if (isVoiceLike(ch.type)) {
    const everyoneSee = perm(VIEW, READ_HISTORY);
    const noVoice = perm(CONNECT, SPEAK);
    await putChannelPermissionOverwrite(token, channelId, guildId, 0, everyoneSee, noVoice);
    await putChannelPermissionOverwrite(
      token,
      channelId,
      linked,
      0,
      perm(VIEW, CONNECT, SPEAK, READ_HISTORY),
      "0",
    );
    if (staffRoleId && staffRoleId !== linked) {
      await putChannelPermissionOverwrite(
        token,
        channelId,
        staffRoleId,
        0,
        perm(VIEW, CONNECT, SPEAK, READ_HISTORY),
        "0",
      );
    }
    if (botUserId) {
      await putChannelPermissionOverwrite(token, channelId, botUserId, 1, botVoice, "0");
    }
    return true;
  }

  return true;
}

export type ApplyGuildLinkedChatLocksResult = {
  ok: boolean;
  updated: number;
  skipped: number;
  errors: number;
  details: Array<{ id: string; name: string; policy: ChannelPolicy }>;
};

export async function applyGuildLinkedChatLocks(
  env: LinkedChatLockEnv,
  opts?: { dryRun?: boolean },
): Promise<ApplyGuildLinkedChatLocksResult> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN).replace(/^bot\s+/i, "");
  const guildId = str(env.DISCORD_ROOTMC_GUILD_ID);
  const linkedRoleId = str(env.DISCORD_ROOTMC_LINKED_ROLE_ID);
  const staffRoleId = str(env.DISCORD_ROOTMC_STAFF_ROLE_ID);
  const dryRun = Boolean(opts?.dryRun);

  const out: ApplyGuildLinkedChatLocksResult = {
    ok: false,
    updated: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  if (!token || !guildId || !linkedRoleId) {
    return out;
  }

  const channels = await listGuildChannels(token, guildId);
  const byId = channelById(channels);
  const botUserId = (await fetchBotUserId(token)) || "";

  for (const ch of channels) {
    const policy = resolveChannelPolicy(ch, env, byId);
    out.details.push({ id: String(ch.id), name: String(ch.name || ""), policy });
    if (policy === "skip") {
      out.skipped++;
      continue;
    }
    if (dryRun) {
      out.updated++;
      continue;
    }
    const ok = await applyLinkedChatLockToChannel(token, guildId, String(ch.id), linkedRoleId, {
      staffRoleId,
      botUserId,
      policy,
    });
    if (ok) out.updated++;
    else out.errors++;
  }

  out.ok = out.errors === 0;
  return out;
}
