/**
 * RootMC season arcs  -  community-approved announcer themes synced to root-announcer.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { sendChannelMessage } from "./discord-rootmc-api";
import { json } from "./cors";
import { str } from "./realm-lib";

export type SeasonEnv = {
  DB: D1Database;
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID?: string;
};

export const DEFAULT_SERVER_ID = "rootmc";

function nowIso(): string {
  return new Date().toISOString();
}

function seasonId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function parseSeasonLinesJson(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => str(v)).filter((v) => v.length > 0);
  }
  const text = str(raw);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((v) => str(v)).filter((v) => v.length > 0);
    }
  } catch {
    /* fall through */
  }
  return text
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function defaultSeasonLines(title: string, theme: string): string[] {
  const safeTitle = title.slice(0, 80);
  const safeTheme = theme.slice(0, 120);
  return [
    `&6Season arc: &f${safeTitle}`,
    `&7Theme: &f${safeTheme}&7  -  join the community on &f/discord&7!`,
    "&7This season was approved by a community vote  -  explore and participate!",
  ];
}

export async function getActiveSeason(db: D1Database, serverId = DEFAULT_SERVER_ID) {
  return db
    .prepare(
      `SELECT id, server_id, title, theme, announcer_lines_json, proposal_id, status, activated_at, ends_at
       FROM rootmc_season_arcs
       WHERE server_id = ? AND status = 'active'
       ORDER BY activated_at DESC
       LIMIT 1`,
    )
    .bind(serverId)
    .first<Record<string, unknown>>();
}

export function seasonPayload(row: Record<string, unknown> | null) {
  if (!row) return { active: null };
  const lines = parseSeasonLinesJson(row.announcer_lines_json);
  return {
    active: {
      id: str(row.id),
      server_id: str(row.server_id) || DEFAULT_SERVER_ID,
      title: str(row.title),
      theme: str(row.theme),
      announcer_lines: lines,
      proposal_id: str(row.proposal_id) || null,
      status: str(row.status),
      activated_at: str(row.activated_at),
      ends_at: str(row.ends_at) || null,
    },
  };
}

export async function activateSeasonFromProposal(
  env: SeasonEnv,
  proposalId: string,
  serverId = DEFAULT_SERVER_ID,
): Promise<{ ok: boolean; detail: string }> {
  const row = await env.DB.prepare(`SELECT * FROM rootmc_community_proposals WHERE id = ? LIMIT 1`)
    .bind(proposalId)
    .first<Record<string, unknown>>();
  if (!row) return { ok: false, detail: "Unknown proposal." };
  if (str(row.kind) !== "season_arc") {
    return { ok: false, detail: "Not a season arc proposal." };
  }

  const title = str(row.title);
  const theme = str(row.season_theme) || title;
  let lines = parseSeasonLinesJson(row.season_lines_json);
  if (lines.length === 0) {
    lines = defaultSeasonLines(title, theme);
  }

  const id = seasonId();
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE rootmc_season_arcs SET status = 'ended', ends_at = ? WHERE server_id = ? AND status = 'active'`,
  )
    .bind(now, serverId)
    .run();

  await env.DB.prepare(
    `INSERT INTO rootmc_season_arcs
       (id, server_id, title, theme, announcer_lines_json, proposal_id, status, activated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  )
    .bind(id, serverId, title, theme, JSON.stringify(lines), proposalId, now, now)
    .run();

  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const generalId = str(env.DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID);
  if (token && generalId) {
    await sendChannelMessage(token, generalId, {
      content:
        `**Season arc started  -  ${title}**\n` +
        `Theme: **${theme}**\n` +
        `_Proposal \`${proposalId}\`  -  in-game tips rotate on the server announcer._`,
    });
  }

  return { ok: true, detail: `Season **${title}** is now active (${lines.length} announcer line(s)).` };
}

export async function handleRootMcSeason(
  _request: Request,
  env: SeasonEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/season")) return null;
  const rest = subpath.slice("/rootmc/season".length) || "/";

  if (method === "GET" && (rest === "" || rest === "/")) {
    const row = await getActiveSeason(env.DB);
    return json(seasonPayload(row));
  }

  return json({ detail: "Not Found" }, 404);
}
