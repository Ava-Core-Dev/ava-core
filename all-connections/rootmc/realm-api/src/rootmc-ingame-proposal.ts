/**
 * In-game /proposal — queue only. Ava alone formalizes into PROP + Discord thread + poll.
 * Fee (64 G) is charged in-game to Server Reserve before this call; refund on failure.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { record, str } from "./realm-lib";
import type { RootStatEnv } from "./rootstat-minecraft";
import { validateServerAuth } from "./rootstat-minecraft";
import { callGrokJsonObject, type RootMcAiEnv } from "./rootmc-world-ai";
import { submitLegislationItem, type LegislatureEnv } from "./rootmc-legislature";
import { allocateGovernanceCode } from "./rootmc-governance-ids";
import { GOVERNANCE_TERMS_VERSION, termsAcceptedForDiscord } from "./rootmc-governance-terms";
import { validateDevWorkstationAuth, type DevWorkstationEnv } from "./rootmc-dev-workstation";

/** Must match in-game charge. */
export const INGAME_PROPOSAL_FEE_G = 64;

const AVA_COMPREHEND_PROMPT =
  "You are Ava Ivy, RootMC Council clerk and Discord bot. A linked player paid 64 Gold to the Server Reserve " +
  "to submit an in-game proposal idea. Rewrite their free text into a formal citizen proposal in your voice: " +
  "clear, friendly, precise. Currency is Gold (G), never dollars. Preserve the player's intent and any numbers. " +
  "Do not invent major new systems they did not ask for. Pick the best category. Return JSON only: " +
  '{"title":"<=120 chars","description":"<=2000 chars markdown","category":"constitution|governance|plugin|metric",' +
  '"ava_note":"<=200 chars — one sentence in Ava\'s voice acknowledging the idea"}';

type IngameProposalEnv = RootStatEnv & RootMcAiEnv & LegislatureEnv & DevWorkstationEnv;

function stripMcColors(text: string): string {
  return text.replace(/§[0-9a-fk-or]/gi, "").replace(/&[0-9a-fk-or]/gi, "").trim();
}

function safeText(s: string): string {
  return s.replace(/```/g, "'''").replace(/\r\n/g, "\n").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

async function resolveDiscordByMinecraftUuid(
  db: D1Database,
  uuid: string,
): Promise<{ discordUserId: string; username: string } | null> {
  const row = await db
    .prepare(
      `SELECT m.minecraft_username, d.discord_user_id
       FROM rootstat_minecraft_links m
       INNER JOIN discord_account_links d ON d.account_id = m.account_id
       WHERE LOWER(m.minecraft_uuid) = ? AND d.discord_user_id IS NOT NULL AND TRIM(d.discord_user_id) != ''
       LIMIT 1`,
    )
    .bind(uuid.toLowerCase())
    .first<{ minecraft_username: string | null; discord_user_id: string }>();
  const discordUserId = str(row?.discord_user_id);
  if (!discordUserId) return null;
  return {
    discordUserId,
    username: str(row?.minecraft_username) || uuid.slice(0, 8),
  };
}

async function avaComprehend(
  env: IngameProposalEnv,
  username: string,
  message: string,
): Promise<{ title: string; description: string; category: string; avaNote: string }> {
  const ai = await callGrokJsonObject(env, AVA_COMPREHEND_PROMPT, {
    player: username,
    fee_g: INGAME_PROPOSAL_FEE_G,
    raw_message: message.slice(0, 3500),
  });
  if (ai.ok === false) {
    const title = message.length > 80 ? message.slice(0, 77) + "…" : message;
    return {
      title: title || "Citizen proposal",
      description:
        message +
        "\n\n---\n_Submitted in-game via `/proposal`. Ava could not rewrite this turn — original text kept._",
      category: "governance",
      avaNote: "Logged your idea for Council discussion.",
    };
  }
  const title = str(ai.title).slice(0, 120) || "Citizen proposal";
  let description = str(ai.description).slice(0, 2000);
  if (!description) description = message.slice(0, 2000);
  const catRaw = str(ai.category).toLowerCase();
  const category =
    catRaw === "constitution" || catRaw === "governance" || catRaw === "plugin" || catRaw === "metric"
      ? catRaw
      : "governance";
  const avaNote = str(ai.ava_note).slice(0, 200) || "I've drafted this for the Council pipeline.";
  description +=
    `\n\n---\n_Ava's draft from in-game \`/proposal\` by **${username}** (64 G fee to Server Reserve)._\n` +
    `_Original:_ ${message.slice(0, 800)}`;
  return { title, description: description.slice(0, 4000), category, avaNote };
}

type IdeaRow = {
  id: string;
  minecraft_uuid: string;
  minecraft_username: string;
  discord_user_id: string;
  raw_message: string;
  fee_g: number;
  status: string;
  legislation_item_id: string | null;
  created_at: string;
};

async function formalizeIdea(
  env: IngameProposalEnv,
  idea: IdeaRow,
): Promise<{ ok: boolean; detail: string; itemId?: string; title?: string }> {
  const claimedAt = nowIso();
  const claim = await env.DB.prepare(
    `UPDATE rootmc_proposal_ideas
     SET status = 'formalizing', claimed_at = ?, updated_at = ?, error_detail = NULL
     WHERE id = ? AND status IN ('queued', 'formalizing')`,
  )
    .bind(claimedAt, claimedAt, idea.id)
    .run();
  if (!claim.meta?.changes) {
    return { ok: false, detail: "Idea not available to formalize." };
  }

  try {
    const drafted = await avaComprehend(env, idea.minecraft_username, idea.raw_message);
    const result = await submitLegislationItem(env, {
      discordUserId: idea.discord_user_id,
      title: drafted.title,
      description: drafted.description,
      category: drafted.category,
      requireVoteShards: false,
    });

    if (!result.ok || !result.itemId) {
      const failAt = nowIso();
      await env.DB.prepare(
        `UPDATE rootmc_proposal_ideas
         SET status = 'queued', error_detail = ?, updated_at = ?, claimed_at = NULL
         WHERE id = ?`,
      )
        .bind((result.detail || "formalize failed").slice(0, 500), failAt, idea.id)
        .run();
      return { ok: false, detail: result.detail || "Could not create proposal." };
    }

    const doneAt = nowIso();
    await env.DB.prepare(
      `UPDATE rootmc_proposal_ideas
       SET status = 'formalized', legislation_item_id = ?, ava_title = ?, ava_description = ?,
           category = ?, formalized_at = ?, updated_at = ?, error_detail = NULL
       WHERE id = ?`,
    )
      .bind(
        result.itemId,
        drafted.title,
        drafted.description.slice(0, 4000),
        drafted.category,
        doneAt,
        doneAt,
        idea.id,
      )
      .run();

    return {
      ok: true,
      detail: result.detail,
      itemId: result.itemId,
      title: drafted.title,
    };
  } catch (e) {
    const failAt = nowIso();
    const msg = e instanceof Error ? e.message : String(e);
    await env.DB.prepare(
      `UPDATE rootmc_proposal_ideas
       SET status = 'queued', error_detail = ?, updated_at = ?, claimed_at = NULL
       WHERE id = ?`,
    )
      .bind(msg.slice(0, 500), failAt, idea.id)
      .run();
    return { ok: false, detail: msg };
  }
}

/**
 * POST /api/rootmc/ingame-proposal — enqueue only (server auth).
 * GET/POST /api/governance/proposal-ideas* — Ava workstation formalize.
 */
export async function handleRootMcIngameProposal(
  request: Request,
  env: IngameProposalEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/ingame-proposal")) return null;

  if (method !== "POST" || subpath !== "/rootmc/ingame-proposal") {
    return json({ detail: "Not Found" }, 404);
  }

  const server = await validateServerAuth(env, request);
  if (server instanceof Response) return server;

  let body: Record<string, unknown>;
  try {
    body = record(JSON.parse(await request.text()));
  } catch {
    return json({ detail: "Invalid JSON body.", refund: true }, 400);
  }

  const uuid = stripMcColors(str(body.uuid)).toLowerCase();
  const username = stripMcColors(str(body.username));
  const message = safeText(stripMcColors(str(body.message)));

  if (!uuid || !username) {
    return json({ ok: false, detail: "uuid and username are required.", refund: true }, 200);
  }
  if (message.length < 12) {
    return json({ ok: false, detail: "Proposal message too short (min ~12 characters).", refund: true }, 200);
  }
  if (message.length > 3500) {
    return json({ ok: false, detail: "Proposal message too long (max 3500 characters).", refund: true }, 200);
  }

  const linked = await resolveDiscordByMinecraftUuid(env.DB, uuid);
  if (!linked) {
    return json(
      {
        ok: false,
        detail: "Link Discord at https://rootmc.net/verify before using /proposal.",
        refund: true,
        verify_url: "https://rootmc.net/verify",
      },
      200,
    );
  }

  const termsOk = await termsAcceptedForDiscord(env.DB, linked.discordUserId);
  if (!termsOk) {
    return json(
      {
        ok: false,
        detail: `Accept Terms of Service at https://rootmc.net/terms/ (version ${GOVERNANCE_TERMS_VERSION}) before submitting.`,
        refund: true,
        terms_url: "https://rootmc.net/terms/",
      },
      200,
    );
  }

  let ideaId: string;
  try {
    ideaId = await allocateGovernanceCode(env.DB, "IDEA");
    await env.DB.prepare(
      `INSERT INTO rootmc_proposal_ideas
         (id, minecraft_uuid, minecraft_username, discord_user_id, raw_message, fee_g, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    )
      .bind(
        ideaId,
        uuid,
        username || linked.username,
        linked.discordUserId,
        message,
        INGAME_PROPOSAL_FEE_G,
        nowIso(),
        nowIso(),
      )
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json(
      {
        ok: false,
        detail: msg.includes("no such table")
          ? "Proposal queue not ready — try again shortly."
          : `Could not queue proposal: ${msg.slice(0, 200)}`,
        refund: true,
      },
      200,
    );
  }

  return json({
    ok: true,
    queued: true,
    idea_id: ideaId,
    item_id: null,
    title: null,
    ava_note: "Queued for Ava — she'll publish the formal proposal when she's online.",
    url: "https://rootmc.net/council/",
    fee_g: INGAME_PROPOSAL_FEE_G,
    vote_reward_g: 3,
    detail: `Idea **${ideaId}** queued. Ava will create the Council proposal (and Discord thread) when online.`,
    server_id: server.serverId,
  });
}

/** Ava / workstation routes under /api/governance/proposal-ideas */
export async function handleProposalIdeaRoutes(
  request: Request,
  env: IngameProposalEnv,
  rest: string,
  method: string,
): Promise<Response | null> {
  if (!rest.startsWith("proposal-ideas")) return null;

  if (!validateDevWorkstationAuth(request, env)) {
    return json({ detail: "Unauthorized." }, 401);
  }

  if (method === "GET" && (rest === "proposal-ideas" || rest === "proposal-ideas/")) {
    const url = new URL(request.url);
    const status = str(url.searchParams.get("status")) || "queued";
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20) || 20));
    const { results } = await env.DB.prepare(
      `SELECT id, minecraft_uuid, minecraft_username, discord_user_id, raw_message, fee_g, status,
              legislation_item_id, error_detail, created_at, claimed_at, formalized_at
       FROM rootmc_proposal_ideas
       WHERE status = ?
       ORDER BY created_at ASC
       LIMIT ?`,
    )
      .bind(status, limit)
      .all<Record<string, unknown>>();
    return json({ ok: true, ideas: results || [] });
  }

  const formalizeMatch = rest.match(/^proposal-ideas\/([^/]+)\/formalize\/?$/);
  if (method === "POST" && formalizeMatch) {
    const id = decodeURIComponent(formalizeMatch[1]);
    const idea = await env.DB.prepare(
      `SELECT id, minecraft_uuid, minecraft_username, discord_user_id, raw_message, fee_g, status,
              legislation_item_id, created_at
       FROM rootmc_proposal_ideas WHERE id = ? LIMIT 1`,
    )
      .bind(id)
      .first<IdeaRow>();
    if (!idea) return json({ ok: false, detail: "not_found" }, 404);
    if (idea.status === "formalized" && idea.legislation_item_id) {
      return json({
        ok: true,
        already: true,
        idea_id: idea.id,
        item_id: idea.legislation_item_id,
        url: `https://rootmc.net/governance/proposal/?id=${encodeURIComponent(idea.legislation_item_id)}`,
      });
    }
    if (idea.status !== "queued" && idea.status !== "formalizing") {
      return json({ ok: false, detail: `Idea status is ${idea.status}.` }, 400);
    }
    const result = await formalizeIdea(env, idea);
    return json(
      {
        ok: result.ok,
        detail: result.detail,
        idea_id: idea.id,
        item_id: result.itemId || null,
        title: result.title || null,
        url: result.itemId
          ? `https://rootmc.net/governance/proposal/?id=${encodeURIComponent(result.itemId)}`
          : null,
      },
      result.ok ? 200 : 400,
    );
  }

  /** Drain next queued idea (Ava boot/wake). */
  if (method === "POST" && (rest === "proposal-ideas/process-next" || rest === "proposal-ideas/process-next/")) {
    const idea = await env.DB.prepare(
      `SELECT id, minecraft_uuid, minecraft_username, discord_user_id, raw_message, fee_g, status,
              legislation_item_id, created_at
       FROM rootmc_proposal_ideas
       WHERE status = 'queued'
       ORDER BY created_at ASC
       LIMIT 1`,
    ).first<IdeaRow>();
    if (!idea) {
      return json({ ok: true, empty: true, detail: "No queued ideas." });
    }
    const result = await formalizeIdea(env, idea);
    return json({
      ok: result.ok,
      empty: false,
      detail: result.detail,
      idea_id: idea.id,
      item_id: result.itemId || null,
      title: result.title || null,
      url: result.itemId
        ? `https://rootmc.net/governance/proposal/?id=${encodeURIComponent(result.itemId)}`
        : null,
    });
  }

  return json({ detail: "Not Found" }, 404);
}
