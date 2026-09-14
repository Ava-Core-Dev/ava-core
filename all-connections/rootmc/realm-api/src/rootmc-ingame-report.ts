import { json } from "./cors";
import {
  createChannelInvite,
  createForumPostThread,
  createGuildTextChannel,
  createPrivateThread,
  discordChannelSlug,
  discordUserForMinecraftUuid,
  fetchDiscordChannel,
  sendChannelMessage,
  sendDirectMessage,
  setChannelPermissionOverwrite,
  setRoleChannelPermission,
  type DiscordEmbed,
} from "./discord-rootmc-api";
import { record, str } from "./realm-lib";
import type { RootStatEnv } from "./rootstat-minecraft";
import { validateServerAuth } from "./rootstat-minecraft";

type ReportEnv = RootStatEnv & {
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_GUILD_ID?: string;
  DISCORD_ROOTMC_REPORT_TICKETS_CATEGORY_ID?: string;
  DISCORD_ROOTMC_STAFF_ROLE_ID?: string;
};

const DISCORD_TYPE_CATEGORY = 4;
const DISCORD_TYPE_TEXT = 0;
const DISCORD_TYPE_FORUM = 15;

function botToken(env: ReportEnv): string {
  return String(env.DISCORD_ROOTMC_BOT_TOKEN || "").replace(/^bot\s+/i, "").trim();
}

function guildId(env: ReportEnv): string {
  return String(env.DISCORD_ROOTMC_GUILD_ID || "1516108585740800042").trim();
}

function ticketsHubId(env: ReportEnv): string {
  return String(env.DISCORD_ROOTMC_REPORT_TICKETS_CATEGORY_ID || "").trim();
}

function staffRoleId(env: ReportEnv): string {
  return String(env.DISCORD_ROOTMC_STAFF_ROLE_ID || "").trim();
}

function stripMcColors(text: string): string {
  return text.replace(/§[0-9a-fk-or]/gi, "").replace(/&[0-9a-fk-or]/gi, "").trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 3)) + "...";
}

function safeText(s: string): string {
  return s.replace(/```/g, "'''").replace(/\r\n/g, "\n").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function reportEmbed(
  reportId: string,
  reporterName: string,
  reporterUuid: string,
  targetName: string,
  targetUuid: string,
  targetOnline: boolean,
  reason: string,
  serverId: string,
): DiscordEmbed {
  const reasonLine = reason || "(none given)";
  const desc =
    `**Ticket ID:** \`${reportId}\`\n` +
    `**Reporter:** ${reporterName} (\`${reporterUuid}\`)\n` +
    `**Reported:** ${targetName} (\`${targetUuid}\`)\n` +
    `**Online now:** ${targetOnline ? "yes" : "no"}\n` +
    `**Reason:** ${truncate(reasonLine, 500)}\n` +
    `**Server ID:** \`${serverId}\``;
  return {
    title: "Player report ticket",
    description: truncate(desc, 4000),
    color: 0xed4245,
    timestamp: nowIso(),
    footer: { text: `Full bundle: report-${reportId}.txt on game host` },
  };
}

async function applyTicketPermissions(
  token: string,
  channelId: string,
  guild: string,
  reporterDiscord: string | null,
  staffRole: string,
): Promise<void> {
  await setChannelPermissionOverwrite(token, channelId, guild, false);
  if (staffRole) {
    await setRoleChannelPermission(token, channelId, staffRole);
  }
  if (reporterDiscord) {
    await setChannelPermissionOverwrite(token, channelId, reporterDiscord, true);
  }
}

async function postEvidenceChunks(token: string, channelId: string, reportId: string, evidence: string): Promise<void> {
  const chunkSize = 1800;
  if (evidence.length <= chunkSize) {
    await sendChannelMessage(token, channelId, {
      content: `**Evidence (\`${reportId}\`):**\n\`\`\`\n${evidence}\n\`\`\``,
    });
    return;
  }
  await sendChannelMessage(token, channelId, {
    content: `**Evidence (\`${reportId}\`)**  -  part 1/${Math.ceil(evidence.length / chunkSize)}`,
  });
  for (let i = 0, part = 1; i < evidence.length; i += chunkSize, part++) {
    const slice = evidence.slice(i, i + chunkSize);
    await sendChannelMessage(token, channelId, {
      content: `\`\`\`\n${slice}\n\`\`\``,
    });
  }
}

async function createReportTicket(
  env: ReportEnv,
  input: {
    reportId: string;
    reporterUuid: string;
    reporterName: string;
    targetUuid: string;
    targetName: string;
    targetOnline: boolean;
    reason: string;
    evidence: string;
    serverId: string;
  },
): Promise<{ channelId: string; ticketKind: string } | null> {
  const token = botToken(env);
  const hubId = ticketsHubId(env);
  const guild = guildId(env);
  if (!token || !hubId) return null;

  const hub = await fetchDiscordChannel(token, hubId);
  if (!hub) return null;

  const threadName = discordChannelSlug(`ticket-${input.targetName}`, input.reportId);
  const embed = reportEmbed(
    input.reportId,
    input.reporterName,
    input.reporterUuid,
    input.targetName,
    input.targetUuid,
    input.targetOnline,
    input.reason,
    input.serverId,
  );
  const opener = {
    content: `@here New in-game report  -  staff please review.`,
    embeds: [embed],
  };

  const reporterDiscord = await discordUserForMinecraftUuid(env.DB, input.reporterUuid);
  const staffRole = staffRoleId(env);

  if (hub.type === DISCORD_TYPE_FORUM) {
    const thread = await createForumPostThread(token, hub.id, threadName, opener);
    if (!thread?.id) return null;
    await postEvidenceChunks(token, thread.id, input.reportId, input.evidence);
    return { channelId: thread.id, ticketKind: "forum_thread" };
  }

  if (hub.type === DISCORD_TYPE_TEXT) {
    const thread = await createPrivateThread(token, hub.id, threadName, opener);
    if (!thread?.id) return null;
    await postEvidenceChunks(token, thread.id, input.reportId, input.evidence);
    if (reporterDiscord) {
      await sendDirectMessage(
        token,
        reporterDiscord,
        `Your RootMC report ticket for **${input.targetName}** is open: <#${thread.id}>`,
      );
    }
    return { channelId: thread.id, ticketKind: "private_thread" };
  }

  if (hub.type === DISCORD_TYPE_CATEGORY) {
    const topic = `Report ${input.reportId}  -  ${input.reporterName} -> ${input.targetName}`;
    const created = await createGuildTextChannel(token, guild, threadName, hub.id, topic);
    if (!created?.id) return null;
    await applyTicketPermissions(token, created.id, guild, reporterDiscord, staffRole);
    await sendChannelMessage(token, created.id, opener);
    await postEvidenceChunks(token, created.id, input.reportId, input.evidence);
    const invite = await createChannelInvite(token, created.id);
    if (reporterDiscord && invite) {
      await sendDirectMessage(
        token,
        reporterDiscord,
        `Your RootMC report ticket for **${input.targetName}** is open: ${invite}`,
      );
    }
    return { channelId: created.id, ticketKind: "text_channel" };
  }

  console.warn("report_ticket_unsupported_hub_type", hub.id, hub.type);
  return null;
}

/**
 * POST /api/rootmc/ingame-report  -  server-authenticated /report -> Discord ticket.
 * Body: { report_id, reporter_uuid, reporter_name, target_uuid, target_name, target_online, reason, body }
 */
export async function handleRootMcIngameReport(
  request: Request,
  env: ReportEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/ingame-report")) return null;

  if (method !== "POST" || subpath !== "/rootmc/ingame-report") {
    return json({ detail: "Not Found" }, 404);
  }

  const server = await validateServerAuth(env, request);
  if (server instanceof Response) return server;

  let body: Record<string, unknown>;
  try {
    body = record(JSON.parse(await request.text()));
  } catch {
    return json({ detail: "Invalid JSON body." }, 400);
  }

  const reportId = stripMcColors(str(body.report_id));
  const reporterUuid = stripMcColors(str(body.reporter_uuid));
  const reporterName = stripMcColors(str(body.reporter_name));
  const targetUuid = stripMcColors(str(body.target_uuid));
  const targetName = stripMcColors(str(body.target_name));
  const reason = safeText(stripMcColors(str(body.reason)));
  const evidence = safeText(stripMcColors(str(body.body)));
  const targetOnline = Boolean(body.target_online);

  if (!reportId || !reporterUuid || !reporterName || !targetUuid || !targetName) {
    return json({ detail: "report_id, reporter_uuid, reporter_name, target_uuid, and target_name are required." }, 400);
  }
  if (!evidence) {
    return json({ detail: "body is required." }, 400);
  }

  if (!botToken(env) || !ticketsHubId(env)) {
    return json({ detail: "Report tickets are not configured on the API." }, 503);
  }

  const ticket = await createReportTicket(env, {
    reportId,
    reporterUuid,
    reporterName,
    targetUuid,
    targetName,
    targetOnline,
    reason,
    evidence,
    serverId: server.serverId,
  });

  if (!ticket) {
    return json({ detail: "Could not create Discord report ticket." }, 502);
  }

  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO rootmc_discord_report_tickets (
       server_id, report_id, guild_id, channel_id, ticket_kind,
       reporter_uuid, target_uuid, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
     ON CONFLICT(server_id, report_id) DO UPDATE SET
       channel_id = excluded.channel_id,
       ticket_kind = excluded.ticket_kind,
       updated_at = excluded.updated_at`,
  )
    .bind(
      server.serverId,
      reportId,
      guildId(env),
      ticket.channelId,
      ticket.ticketKind,
      reporterUuid,
      targetUuid,
      ts,
      ts,
    )
    .run();

  return json(
    {
      ok: true,
      report_id: reportId,
      ticket_channel_id: ticket.channelId,
      ticket_kind: ticket.ticketKind,
    },
    200,
  );
}
