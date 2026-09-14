import type { ExecutionContext } from "@cloudflare/workers-types";
import {
  ROOTMC_DISCORD_INVITE,
  ROOTMC_REALM_HOME,
  ROOTMC_VERIFY,
  siteUrl,
} from "./rootmc-site";
import nacl from "tweetnacl";

import { featuredServerForMobileConfig, FEATURED_SERVER_DEFAULTS, ROOTMC_SERVER_IP, publicServerAddress, publicMapUrl } from "./rootmc-server";
import { discordBotFetch } from "./discord-rootmc-api";
import {
  executeDiscordPay,
  formatGold,
  getPlayerBalance,
  GOLD_MIN_AMOUNT,
  resolveDiscordEconomyServerId,
  resolveLinkedPlayerByDiscord,
  roundGold,
} from "./discord-rootmc-economy";
import { CLAIMS_SERVER_ID } from "./rootmc-claims-vote-credit";
import { formatItemValueDiscord, formatItemValueDiscordWithCharts, itemValueLookup } from "./rootmc-item-value";
import type { RootMcDailyReportEnv } from "./rootmc-daily-report";
import {
  isSystemReportUser,
  parseSystemReportKind,
  scheduleSystemReportFollowUp,
} from "./rootmc-system-report";
import {
  buildDevUptimePeriodReport,
  memberHasDevUptimeRole,
  parseDevUptimePeriod,
} from "./rootmc-dev-uptime-report";
import {
  handleProposalSlashCommand,
  handleProposalVoteButton,
  isProposalVoteCustomId,
} from "./rootmc-community-proposals";
import { handleGovernanceDiscordVote } from "./rootmc-governance-routes";
import { persistDiscordTimezone } from "./rootmc-activity-mysql";
import { TIMEZONE_DEFS } from "./rootmc-timezone-defs";

export type RootMcDiscordEnv = RootMcDailyReportEnv;

const TIMEZONE_COMPONENT_IDS = new Set(["rootmc_timezone_select_a", "rootmc_timezone_select_b"]);

function hexToUint8(hex: string): Uint8Array | null {
  const h = hex.replace(/\s/g, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(h) || h.length % 2 !== 0) return null;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function verifyDiscordRequest(rawBody: string, headers: Headers, publicKeyHex: string): boolean {
  const sig = headers.get("x-signature-ed25519") || headers.get("X-Signature-Ed25519");
  const ts = headers.get("x-signature-timestamp") || headers.get("X-Signature-Timestamp");
  if (!sig || !ts) return false;
  const pk = hexToUint8(publicKeyHex);
  const sigBytes = hexToUint8(sig);
  if (!pk || pk.length !== 32 || !sigBytes || sigBytes.length !== 64) return false;
  const msg = new TextEncoder().encode(ts + rawBody);
  return nacl.sign.detached.verify(msg, sigBytes, pk);
}

function candidatePublicKeys(env: RootMcDiscordEnv): string[] {
  const keys = new Set<string>();
  const primary = String(env.DISCORD_ROOTMC_PUBLIC_KEY || "").trim();
  if (primary) keys.add(primary);
  const secondary = String((env as unknown as { DISCORD_PUBLIC_KEY?: string }).DISCORD_PUBLIC_KEY || "").trim();
  if (secondary) keys.add(secondary);
  return [...keys];
}

function interactionJson(type: number, data?: { content?: string; flags?: number; embeds?: unknown[] }): Response {
  // Discord rejects `{ type: 5, data: { flags: 64 } }`  -  defer plain, set ephemeral on PATCH follow-up.
  const payload = type === 5 ? { type: 5 } : data ? { type, data } : { type };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function interactionSubcommandName(data: Record<string, unknown> | undefined): string {
  const opts = (data?.options as Array<Record<string, unknown>> | undefined) || [];
  const sub = opts.find((o) => Number(o.type) === 1);
  return String(sub?.name ?? "").trim().toLowerCase();
}

async function editDeferredInteraction(
  applicationId: string,
  interactionToken: string,
  content: string,
  opts?: { ephemeral?: boolean },
): Promise<boolean> {
  const body: Record<string, unknown> = { content: content.slice(0, 2000) };
  if (opts?.ephemeral) body.flags = 64;
  const res = await fetch(
    `https://discord.com/api/v10/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(interactionToken)}/messages/@original`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "RootRecord/rootmc-discord-bot",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    console.error("rootmc_interaction_followup_failed", res.status, await res.text().catch(() => ""));
  }
  return res.ok;
}

function helpText(): string {
  return (
    "**RootMC**  -  Root Record Minecraft SMP\n\n" +
    "- **`/link`**  -  finish Minecraft verify: `/link code:ABC123` (same code as in-game `/link`)\n" +
    "- **`/server`**  -  address, plugin heartbeat, realm links\n" +
    "- **`/value`** or **`/worth`**  -  market price + 7/14/28/365-day trend charts\n" +
    "- **`/balance`** or **`/bal`**  -  your linked wallet gold on Gen 1 + Gen 2\n" +
    "- **`/pay`**  -  send gold to another linked member (min 0.01)\n" +
    "- **`/proposals`**  -  submit, discuss in threads, weekly bill -> #voting (linked accounts + terms)\n" +
    "- **`/vote`**  -  governance % + links to official polls\n" +
    "- **`/devuptime`**  -  weekly/monthly/yearly workstation uptime (dev role)\n" +
    "- Town/nation channels  -  auto-created from in-game Towny (mayor/nation leader gets invite DM)\n\n" +
    "- **`/help`**  -  this message\n\n" +
    "Link: " + ROOTMC_VERIFY + "\n" +
    "Realm: " + ROOTMC_REALM_HOME + "\n" +
    "RootMC Discord: " + ROOTMC_DISCORD_INVITE
  );
}

async function serverStatusContent(db: RootMcDiscordEnv["DB"]): Promise<string> {
  const row = await featuredServerForMobileConfig(db).catch(() => ({}));
  const name = String(row.name || FEATURED_SERVER_DEFAULTS.server_name);
  const address = publicServerAddress(row.address || FEATURED_SERVER_DEFAULTS.server_address);
  const version = String(row.game_version || FEATURED_SERVER_DEFAULTS.game_version);
  const pluginOn = Boolean(row.rootmc_plugin_installed);
  const pluginVer = String(row.rootmc_plugin_version || " - ");
  const lastSeen = String(row.rootmc_last_seen_at || "never");
  const mapUrl = publicMapUrl(String(row.map_url || "").trim() || null);
  const lines = [
    `**${name}**`,
    `**Address:** \`${address}\``,
    `**Version:** ${version}`,
    `**RootMC plugin:** ${pluginOn ? "online" : "offline"} (${pluginVer})`,
    `_Last heartbeat: ${lastSeen.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}_`,
    `**Realm:** ${FEATURED_SERVER_DEFAULTS.realm_url}`,
    `**Verify MC account:** ${FEATURED_SERVER_DEFAULTS.verify_url}`,
  ];
  if (mapUrl) lines.splice(4, 0, `**Map:** ${mapUrl}`);
  return lines.join("\n");
}

function interactionOptionString(data: Record<string, unknown> | undefined, name: string): string {
  const opts = (data?.options as Array<Record<string, unknown>> | undefined) || [];
  const hit = opts.find((o) => String(o.name) === name);
  return String(hit?.value ?? "").trim();
}

function interactionOptionUserId(data: Record<string, unknown> | undefined, name: string): string {
  const opts = (data?.options as Array<Record<string, unknown>> | undefined) || [];
  const hit = opts.find((o) => String(o.name) === name);
  return String(hit?.value ?? "").trim();
}

function interactionOptionNumber(data: Record<string, unknown> | undefined, name: string): number | null {
  const opts = (data?.options as Array<Record<string, unknown>> | undefined) || [];
  const hit = opts.find((o) => String(o.name) === name);
  const v = Number(hit?.value);
  return Number.isFinite(v) ? v : null;
}

function interactionDiscordUserId(interaction: Record<string, unknown>): string {
  const member = (interaction.member as Record<string, unknown> | undefined) || {};
  const memberUser = (member.user as Record<string, unknown> | undefined) || {};
  const user = (interaction.user as Record<string, unknown> | undefined) || {};
  return String(memberUser.id || user.id || "").trim();
}

async function handleBalanceCommand(interaction: Record<string, unknown>, env: RootMcDiscordEnv): Promise<Response> {
  const discordUserId = interactionDiscordUserId(interaction);
  const linked = await resolveLinkedPlayerByDiscord(env.DB, discordUserId);
  if (!linked) {
    return interactionJson(4, {
      content:
        "You need a **verified Minecraft link** first.\n" +
        "Run `/rootmc link` in-game or use " + ROOTMC_VERIFY,
      flags: 64,
    });
  }

  const content = await buildDualServerBalanceContent(env, linked.minecraftUuid, linked.minecraftUsername);
  return interactionJson(4, { content, flags: 64 });
}

async function buildDualServerBalanceContent(
  env: RootMcDiscordEnv,
  minecraftUuid: string,
  linkedUsername: string | null,
): Promise<string> {
  const townyServerId = await resolveDiscordEconomyServerId(env.DB);
  const [towny, claims] = await Promise.all([
    getPlayerBalance(env.DB, townyServerId, minecraftUuid),
    getPlayerBalance(env.DB, CLAIMS_SERVER_ID, minecraftUuid),
  ]);
  const name = linkedUsername || towny.username || claims.username || "your character";
  const townyJoin = ROOTMC_SERVER_IP;
  const claimsJoin = "51.81.176.61:24945";
  const townyLine = `• **Towny** (\`${townyJoin}\`): **${formatGold(towny.balance)}**`;
  const claimsLine = `• **Claims** (\`${claimsJoin}\`): **${formatGold(claims.balance)}**`;
  const combined = `• **Combined:** **${formatGold(roundGold(towny.balance + claims.balance))}**`;
  return `**${name}** — wallet gold\n\n${townyLine}\n${claimsLine}\n${combined}`;
}

async function handlePayCommand(interaction: Record<string, unknown>, env: RootMcDiscordEnv): Promise<Response> {
  const data = (interaction.data as Record<string, unknown> | undefined) || {};
  const discordUserId = interactionDiscordUserId(interaction);
  const recipientDiscordId = interactionOptionUserId(data, "member");
  const rawAmount = interactionOptionNumber(data, "amount");

  if (!recipientDiscordId) {
    return interactionJson(4, { content: "Pick a member to pay.", flags: 64 });
  }
  if (rawAmount == null || roundGold(rawAmount) < GOLD_MIN_AMOUNT) {
    return interactionJson(4, { content: `Minimum payment is **${formatGold(GOLD_MIN_AMOUNT)}**.`, flags: 64 });
  }

  const sender = await resolveLinkedPlayerByDiscord(env.DB, discordUserId);
  if (!sender) {
    return interactionJson(4, {
      content:
        "You need a **verified Minecraft link** to pay.\n" +
        ROOTMC_VERIFY,
      flags: 64,
    });
  }

  const recipient = await resolveLinkedPlayerByDiscord(env.DB, recipientDiscordId);
  if (!recipient) {
    return interactionJson(4, {
      content: "That member is not linked to a Minecraft account yet.",
      flags: 64,
    });
  }

  const result = await executeDiscordPay(
    env.DB,
    await resolveDiscordEconomyServerId(env.DB),
    sender,
    recipient,
    rawAmount,
  );
  if (!result.ok) {
    return interactionJson(4, { content: result.error, flags: 64 });
  }

  return interactionJson(4, {
    content:
      `Paid **${formatGold(result.amount)}** to **${result.recipientName}**.\n` +
      `Your balance: **${formatGold(result.newBalance)}**`,
    flags: 64,
  });
}

type GuildRole = { id: string; name: string };

async function listGuildRoles(token: string, guildId: string): Promise<GuildRole[]> {
  const res = await discordBotFetch(token, `/guilds/${encodeURIComponent(guildId)}/roles`);
  if (!res.ok) return [];
  const rows = (await res.json()) as GuildRole[];
  return Array.isArray(rows) ? rows : [];
}

async function getMemberRoleIds(token: string, guildId: string, userId: string): Promise<string[]> {
  const res = await discordBotFetch(token, `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`);
  if (!res.ok) return [];
  const row = (await res.json()) as { roles?: string[] };
  return Array.isArray(row.roles) ? row.roles.map((r) => String(r)) : [];
}

async function patchMemberRoleIds(token: string, guildId: string, userId: string, roleIds: string[]): Promise<boolean> {
  const res = await discordBotFetch(token, `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({ roles: roleIds }),
  });
  return res.ok;
}

async function applyTimezoneRole(
  interaction: Record<string, unknown>,
  env: RootMcDiscordEnv,
  ctx?: ExecutionContext,
): Promise<Response> {
  const token = String(env.DISCORD_ROOTMC_BOT_TOKEN || "").replace(/^bot\s+/i, "").trim();
  const guildId = String(env.DISCORD_ROOTMC_GUILD_ID || "");
  const member = (interaction.member as Record<string, unknown> | undefined) || {};
  const user = (member.user as Record<string, unknown> | undefined) || {};
  const userId = String(user.id || "").trim();
  if (!token || !guildId || !userId) {
    return interactionJson(4, { content: "Timezone roles are not configured yet.", flags: 64 });
  }

  const data = (interaction.data as Record<string, unknown> | undefined) || {};
  const values = Array.isArray(data.values) ? data.values.map((v) => String(v)) : [];
  const selected = TIMEZONE_DEFS.find((t) => values.includes(t.key));
  if (!selected) {
    return interactionJson(4, { content: "Select a timezone option from the menu.", flags: 64 });
  }

  const roles = await listGuildRoles(token, guildId);
  const timezoneRoleIds = new Set(
    TIMEZONE_DEFS.map((t) => roles.find((r) => r.name === t.roleName)?.id).filter((v): v is string => Boolean(v)),
  );
  const selectedRoleId = roles.find((r) => r.name === selected.roleName)?.id;
  if (!selectedRoleId) {
    return interactionJson(4, { content: `Role missing: ${selected.roleName}. Ask an admin to run setup.`, flags: 64 });
  }

  const existing = await getMemberRoleIds(token, guildId, userId);
  const next = existing.filter((id) => !timezoneRoleIds.has(id));
  next.push(selectedRoleId);
  const ok = await patchMemberRoleIds(token, guildId, userId, [...new Set(next)]);
  if (!ok) {
    return interactionJson(4, { content: "Could not update your roles. Please try again.", flags: 64 });
  }

  const persist = persistDiscordTimezone(env, userId, selected.key).catch((e) =>
    console.error("rootmc_activity_timezone_persist_failed", e),
  );
  if (ctx) {
    ctx.waitUntil(persist);
  } else {
    await persist;
  }

  return interactionJson(4, { content: `Timezone set to **${selected.label}**.`, flags: 64 });
}

async function handleSystemReportCommand(
  interaction: Record<string, unknown>,
  env: RootMcDiscordEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const discordUserId = interactionDiscordUserId(interaction);
  if (!isSystemReportUser(discordUserId)) {
    return interactionJson(4, { content: "You do not have permission to use this command.", flags: 64 });
  }

  const data = (interaction.data as Record<string, unknown> | undefined) || {};
  const kind = parseSystemReportKind(interactionSubcommandName(data));
  if (!kind) {
    return interactionJson(4, {
      content: "Pick a report: **`/systemreport all`**, **`daily`**, **`economy`**, **`towns`**, or **`nations`**.",
      flags: 64,
    });
  }

  const applicationId = String(interaction.application_id || env.DISCORD_ROOTMC_CLIENT_ID || "").trim();
  const interactionToken = String(interaction.token || "").trim();
  if (!applicationId || !interactionToken) {
    return interactionJson(4, { content: "Interaction metadata missing.", flags: 64 });
  }

  const patch = (content: string) =>
    editDeferredInteraction(applicationId, interactionToken, content, { ephemeral: true });

  scheduleSystemReportFollowUp(
    env,
    kind,
    ctx,
    patch,
    (content) => patch(`Failed: ${content}`),
    () => patch("Running reports... (may take a few minutes)"),
  );
  return interactionJson(5);
}

async function handleDevUptimeCommand(
  interaction: Record<string, unknown>,
  env: RootMcDiscordEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!memberHasDevUptimeRole(interaction)) {
    return interactionJson(4, {
      content: "You need the **dev** role to run `/devuptime`.",
      flags: 64,
    });
  }

  const data = (interaction.data as Record<string, unknown> | undefined) || {};
  const period = parseDevUptimePeriod(interactionSubcommandName(data));
  if (!period) {
    return interactionJson(4, {
      content: "Pick a period: **`/devuptime weekly`**, **`monthly`**, or **`yearly`**.",
      flags: 64,
    });
  }

  const applicationId = String(interaction.application_id || env.DISCORD_ROOTMC_CLIENT_ID || "").trim();
  const interactionToken = String(interaction.token || "").trim();
  if (!applicationId || !interactionToken) {
    return interactionJson(4, { content: "Interaction metadata missing.", flags: 64 });
  }

  const patch = (content: string) =>
    editDeferredInteraction(applicationId, interactionToken, content, { ephemeral: true });

  ctx.waitUntil(
    (async () => {
      try {
        await patch(`Building **${period}** uptime report...`);
        const report = await buildDevUptimePeriodReport(env.DB, period);
        await patch(report);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("rootmc_devuptime_failed", msg);
        await patch(`Failed to build report: ${msg.slice(0, 500)}`);
      }
    })(),
  );
  return interactionJson(5);
}

export async function handleRootMcDiscordInteractions(
  request: Request,
  env: RootMcDiscordEnv,
  ctx?: ExecutionContext,
): Promise<Response> {
  const keys = candidatePublicKeys(env);
  if (!keys.length) {
    return new Response(JSON.stringify({ detail: "DISCORD_ROOTMC_PUBLIC_KEY not set" }), { status: 503 });
  }

  const rawBody = await request.text();
  const verified = keys.some((pk) => verifyDiscordRequest(rawBody, request.headers, pk));
  if (!verified) {
    return new Response("invalid request signature", { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const t = Number(body.type);
  if (t === 1) return interactionJson(1);

  if (t === 3) {
    const data = (body.data as Record<string, unknown> | undefined) || {};
    const customId = String(data.custom_id || "").trim();
    if (TIMEZONE_COMPONENT_IDS.has(customId)) {
      return applyTimezoneRole(body, env, ctx);
    }
    if (isProposalVoteCustomId(customId)) {
      const userId = interactionDiscordUserId(body);
      return handleProposalVoteButton(env, customId, userId);
    }
    return interactionJson(4, { content: "Unsupported component interaction.", flags: 64 });
  }

  if (t === 2) {
    const cmd = String((body.data as Record<string, unknown> | undefined)?.name || "").toLowerCase();
    if (cmd === "help") {
      return interactionJson(4, { content: helpText(), flags: 64 });
    }

    if (cmd === "link") {
      const code = (interactionOptionString(body.data as Record<string, unknown>, "code") || "").toUpperCase();
      const userId = interactionDiscordUserId(body);
      const member = (body.member as Record<string, unknown> | undefined)?.user as
        | Record<string, unknown>
        | undefined;
      const user = (body.user as Record<string, unknown> | undefined) || member || {};
      if (!code || code.length !== 6) {
        return interactionJson(4, {
          content: "Provide your 6-character in-game code: `/link code:ABC123` (from `/link` in Minecraft).",
          flags: 64,
        });
      }
      if (!userId) {
        return interactionJson(4, { content: "Could not resolve your Discord user id.", flags: 64 });
      }
      const { completeMinecraftDiscordBind } = await import("./discord-rootmc-player-link");
      const bind = await completeMinecraftDiscordBind(env, {
        code,
        discordUserId: userId,
        discordUsername: String(user.username || "") || null,
        discordGlobalName: String(user.global_name || "") || null,
        ctx,
      });
      if (!bind.ok) {
        const msg =
          bind.reason === "already_linked"
            ? "That Discord account is already linked to a different Minecraft player."
            : bind.reason === "code_invalid"
              ? "Invalid or expired code. Run `/link` in-game again."
              : bind.detail || "Link failed.";
        return interactionJson(4, { content: msg, flags: 64 });
      }
      return interactionJson(4, {
        content: bind.alreadyLinked
          ? `Already linked to **${bind.minecraftUsername}**. Roles refreshed.`
          : `Linked to **${bind.minecraftUsername}**. Welcome — check in-game for your link bonus.`,
        flags: 64,
      });
    }

    const applicationId = String(body.application_id || env.DISCORD_ROOTMC_CLIENT_ID || "").trim();
    const interactionToken = String(body.token || "").trim();
    const canDefer = Boolean(ctx && applicationId && interactionToken);
    const patch = (content: string) =>
      editDeferredInteraction(applicationId, interactionToken, content, { ephemeral: true });

    // Defer slow DB/chart/cross-gen commands — Discord requires ACK within 3s.
    if (
      canDefer
      && (cmd === "server"
        || cmd === "value"
        || cmd === "worth"
        || cmd === "vote"
        || cmd === "balance"
        || cmd === "bal")
    ) {
      ctx!.waitUntil(
        (async () => {
          try {
            if (cmd === "server") {
              await patch(await serverStatusContent(env.DB));
              return;
            }
            if (cmd === "vote") {
              const userId = interactionDiscordUserId(body);
              const content = await handleGovernanceDiscordVote(env, userId);
              await patch(content.slice(0, 2000));
              return;
            }
            if (cmd === "balance" || cmd === "bal") {
              const userId = interactionDiscordUserId(body);
              const linked = await resolveLinkedPlayerByDiscord(env.DB, userId);
              if (!linked) {
                await patch(
                  "You need a **verified Minecraft link** first.\n"
                    + "Run `/rootmc link` in-game or use " + ROOTMC_VERIFY,
                );
                return;
              }
              await patch(
                await buildDualServerBalanceContent(env, linked.minecraftUuid, linked.minecraftUsername),
              );
              return;
            }
            const item = interactionOptionString(body.data as Record<string, unknown>, "item");
            if (!item) {
              await patch("Provide an item name, e.g. `/value item:diamond`.");
              return;
            }
            const result = await itemValueLookup(env.DB, item);
            if (!result.matches.length) {
              await patch(
                `No market price found for **${item}**. Try a material id like \`diamond\` or \`oak_log\`.`,
              );
              return;
            }
            const blocks: string[] = [];
            const primary = result.matches[0];
            blocks.push(await formatItemValueDiscordWithCharts(env.DB, result.server_id, primary));
            for (const row of result.matches.slice(1, 4)) {
              blocks.push(formatItemValueDiscord(row));
            }
            let content = blocks.join("\n\n");
            if (content.length > 1950) {
              content = `${await formatItemValueDiscordWithCharts(env.DB, result.server_id, primary)}\n\n_+${result.matches.length - 1} more match(es)  -  narrow your search for details._`;
            }
            await patch(content);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("rootmc_discord_deferred_cmd_failed", cmd, msg);
            await patch(`Failed: ${msg.slice(0, 500)}`);
          }
        })(),
      );
      return interactionJson(5);
    }

    if (cmd === "server") {
      const content = await serverStatusContent(env.DB);
      return interactionJson(4, { content, flags: 64 });
    }
    if (cmd === "value" || cmd === "worth") {
      const item = interactionOptionString(body.data as Record<string, unknown>, "item");
      if (!item) {
        return interactionJson(4, { content: "Provide an item name, e.g. `/value item:diamond`.", flags: 64 });
      }
      const result = await itemValueLookup(env.DB, item);
      if (!result.matches.length) {
        return interactionJson(4, {
          content: `No market price found for **${item}**. Try a material id like \`diamond\` or \`oak_log\`.`,
          flags: 64,
        });
      }
      const blocks: string[] = [];
      const primary = result.matches[0];
      blocks.push(await formatItemValueDiscordWithCharts(env.DB, result.server_id, primary));
      for (const row of result.matches.slice(1, 4)) {
        blocks.push(formatItemValueDiscord(row));
      }
      let content = blocks.join("\n\n");
      if (content.length > 1950) {
        content = `${await formatItemValueDiscordWithCharts(env.DB, result.server_id, primary)}\n\n_+${result.matches.length - 1} more match(es)  -  narrow your search for details._`;
      }
      return interactionJson(4, { content, flags: 64 });
    }
    if (cmd === "balance" || cmd === "bal") {
      return handleBalanceCommand(body, env);
    }
    if (cmd === "pay") {
      return handlePayCommand(body, env);
    }
    if (cmd === "systemreport") {
      if (!ctx) {
        return interactionJson(4, { content: "Report runner unavailable.", flags: 64 });
      }
      return handleSystemReportCommand(body, env, ctx);
    }
    if (cmd === "devuptime") {
      if (!ctx) {
        return interactionJson(4, { content: "Report runner unavailable.", flags: 64 });
      }
      return handleDevUptimeCommand(body, env, ctx);
    }
    if (cmd === "proposal" || cmd === "proposals") {
      if (canDefer) {
        ctx!.waitUntil(
          (async () => {
            try {
              const res = await handleProposalSlashCommand(body, env);
              const parsed = (await res.json()) as { type?: number; data?: { content?: string; flags?: number } };
              const content = String(parsed?.data?.content || "Done.").slice(0, 2000);
              await patch(content);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error("rootmc_discord_proposal_failed", msg);
              await patch(`Failed: ${msg.slice(0, 500)}`);
            }
          })(),
        );
        return interactionJson(5);
      }
      return handleProposalSlashCommand(body, env);
    }
    if (cmd === "vote") {
      const userId = interactionDiscordUserId(body);
      const content = await handleGovernanceDiscordVote(env, userId);
      return interactionJson(4, { content: content.slice(0, 2000), flags: 64 });
    }
    return interactionJson(4, {
      content: "Unknown command. Try **`/help`**, **`/link`**, **`/server`**, **`/balance`**, **`/pay`**, **`/vote`**, **`/proposal`**, **`/devuptime`**, or **`/value`**.",
      flags: 64,
    });
  }

  return interactionJson(4, { content: "Unsupported interaction.", flags: 64 });
}
