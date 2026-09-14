import type { ExecutionContext } from "@cloudflare/workers-types";
import nacl from "tweetnacl";

import { handleConfigCommand, listGuildAlertDestinations, resolveGuildReportChannelId } from "./discord-kilauea-guild-config";
import { handleKilaueaCommand, type KilaueaReportEnv } from "./discord-kilauea-report";
import { filterKilaueaRelevantOfficialXPosts } from "./kilauea-official-x";
export type KilaueaDiscordEnv = KilaueaReportEnv & {
  DISCORD_KILAUEA_CLIENT_ID?: string;
  DISCORD_KILAUEA_PUBLIC_KEY?: string;
  DISCORD_KILAUEA_ALERTS_CHANNEL_ID?: string;
  DISCORD_KILAUEA_DATA_CHANNEL_ID?: string;
  DISCORD_FEEDBACK_CHANNEL_ID?: string;
  DISCORD_KILAUEA_USGS_WEBHOOK_URL?: string;
};

const DISCORD_CONTENT_LIMIT = 1990;

export function chunkDiscordContent(text: string, max = DISCORD_CONTENT_LIMIT): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  // Prefer splits at markdown section headers so seismic/social blocks stay intact when possible.
  const sections = normalized.split(/(?=\n(?:\*\*[^*]+\*\*|\#{1,3}\s))/).map((s) => s.trim()).filter(Boolean);
  const merged: string[] = [];
  let buf = "";
  for (const section of sections.length ? sections : [normalized]) {
    const next = buf ? `${buf}\n\n${section}` : section;
    if (buf && next.length > max) {
      merged.push(buf);
      buf = section;
    } else {
      buf = next;
    }
  }
  if (buf) merged.push(buf);

  const out: string[] = [];
  for (const block of merged) {
    if (block.length <= max) {
      out.push(block);
      continue;
    }
    let s = block;
    while (s.length > 0) {
      if (s.length <= max) {
        out.push(s);
        break;
      }
      let cut = s.lastIndexOf("\n", max);
      if (cut < 200) cut = max;
      out.push(s.slice(0, cut).trimEnd());
      s = s.slice(cut).trimStart();
    }
  }
  return out.filter(Boolean);
}

function scrubAiReportText(raw: string): string {
  return raw
    .replace(/\bGrok\b/gi, "AI")
    .replace(/\bxAI\b/g, "AI")
    .trim();
}

function cleanSocialPostText(raw: unknown, max = 500): string {
  const s = String(raw ?? "")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…` : s;
}

/** Remove AI-summarized official social (often truncated) before appending full posts. */
export function stripOfficialSocialSection(text: string): string {
  const markers = [
    /\n\n\*{0,2}Official social\*{0,2}:?[\s\S]*$/i,
    /\nOfficial social:.*$/i,
  ];
  let out = text.trim();
  for (const re of markers) out = out.replace(re, "").trim();
  return out;
}

export function formatOfficialSocialSection(
  posts: Array<Record<string, unknown>>,
  opts?: { maxPosts?: number; maxChars?: number },
): string {
  const maxPosts = opts?.maxPosts ?? 6;
  const maxChars = opts?.maxChars ?? 500;
  const lines = filterKilaueaRelevantOfficialXPosts(posts).slice(0, maxPosts).map((post) => {
    const account = String(post.account || "Official").trim();
    const text = cleanSocialPostText(post.text, maxChars);
    return text ? `• ${account}: ${text}` : "";
  }).filter(Boolean);
  if (!lines.length) return "";
  return ["**Official social**", ...lines].join("\n");
}

/** Full report body for Discord — no per-field truncation (chunkDiscordContent splits for API limits). */
export function buildKilaueaAnalysisDiscordBody(
  row: {
    headline?: string | null;
    event?: string | null;
    source_type?: string | null;
    free_text?: string | null;
    pro_text?: string | null;
  },
  opts?: { officialPosts?: Array<Record<string, unknown>> },
): string {
  const headline = `**Kīlauea AI Analysis** — ${row.headline || row.event || row.source_type || "update"}`;
  const free = scrubAiReportText(String(row.free_text || ""));
  let pro = scrubAiReportText(String(row.pro_text || ""));
  if (opts?.officialPosts?.length) {
    pro = stripOfficialSocialSection(pro);
    const social = formatOfficialSocialSection(opts.officialPosts);
    if (social) pro = pro ? `${pro}\n\n${social}` : social;
  }
  const parts = [headline];
  if (free) parts.push(free);
  if (pro && pro !== free) parts.push(pro);
  return parts.join("\n\n");
}

export function truncateDiscordContent(s: string, max = DISCORD_CONTENT_LIMIT): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 3)) + "...";
}

export function kilaueaBotToken(env: KilaueaDiscordEnv): string {
  return String(env.DISCORD_KILAUEA_BOT_TOKEN || env.DISCORD_BOT_TOKEN || "")
    .replace(/^bot\s+/i, "")
    .trim();
}

export async function postKilaueaDiscordMessage(
  env: KilaueaDiscordEnv,
  channelId: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const token = kilaueaBotToken(env);
  const cid = String(channelId || "").trim();
  if (!token || token.length < 40 || !/^\d{10,}$/.test(cid)) return false;
  const res = await fetch(`https://discord.com/api/v10/channels/${cid}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.warn("kilauea_discord_post", res.status, (await res.text().catch(() => "")).slice(0, 200));
  }
  return res.ok;
}

async function postToChannelWithFallbacks(
  env: KilaueaDiscordEnv,
  channelId: string,
  payload: Record<string, unknown>,
  opts?: { allowWebhook?: boolean },
): Promise<boolean> {
  const cid = String(channelId || "").trim();
  if (!/^\d{10,}$/.test(cid)) return false;
  if (await postKilaueaDiscordMessage(env, cid, payload)) return true;

  const rootToken = String(env.DISCORD_BOT_TOKEN || "")
    .replace(/^bot\s+/i, "")
    .trim();
  const kilaueaToken = kilaueaBotToken(env);
  if (rootToken.length >= 40 && rootToken !== kilaueaToken) {
    const res = await fetch(`https://discord.com/api/v10/channels/${cid}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${rootToken}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return true;
  }

  if (opts?.allowWebhook !== false) {
    const legacyChannel = String(env.DISCORD_KILAUEA_REPORT_CHANNEL_ID || env.DISCORD_KILAUEA_ALERTS_CHANNEL_ID || "").trim();
    const webhook = String(env.DISCORD_KILAUEA_USGS_WEBHOOK_URL || "").trim();
    if (cid === legacyChannel && /^https:\/\/discord(?:app)?\.com\/api\/webhooks\//.test(webhook)) {
      const content = typeof payload.content === "string" ? payload.content : undefined;
      const embeds = Array.isArray(payload.embeds) ? payload.embeds : undefined;
      const whBody: Record<string, unknown> = {
        username: "Kilauea Alerts",
        avatar_url: "https://rootrecord.online/favicon.png",
      };
      if (content) whBody.content = content;
      if (embeds?.length) whBody.embeds = embeds;
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(whBody),
      });
      if (res.ok) return true;
    }
  }
  return false;
}

/** Post AI report — one guild, or fan-out to all configured servers. Long reports are split across messages. */
export async function postKilaueaReportContent(
  env: KilaueaDiscordEnv,
  content: string,
  opts?: { guildId?: string; sourceId?: string },
): Promise<boolean> {
  const chunks = chunkDiscordContent(content);
  if (!chunks.length) return false;

  async function postAllChunks(channelId: string, allowWebhook: boolean): Promise<boolean> {
    let posted = false;
    const total = chunks.length;
    for (let i = 0; i < chunks.length; i++) {
      const suffix = total > 1 ? `\n\n_${i + 1}/${total}_` : "";
      const chunk = chunks[i]!;
      const room = DISCORD_CONTENT_LIMIT - suffix.length;
      const body = chunk.length > room ? chunk.slice(0, room).trimEnd() : chunk;
      const payload = { content: body + suffix, allowed_mentions: { parse: [] } };
      const ok = await postToChannelWithFallbacks(env, channelId, payload, { allowWebhook });
      if (!ok) return posted;
      posted = true;
    }
    return posted;
  }

  let nativeOk = false;

  if (opts?.guildId && env.DB) {
    const channelId = await resolveGuildReportChannelId(env.DB, env, opts.guildId);
    if (channelId) nativeOk = await postAllChunks(channelId, false);
  } else if (env.DB) {
    const dests = await listGuildAlertDestinations(env.DB, env);
    for (const d of dests) {
      if (await postAllChunks(d.channel_id, true)) nativeOk = true;
    }
    if (!nativeOk) {
      const channelId = String(env.DISCORD_KILAUEA_REPORT_CHANNEL_ID || "1545283785803960393").trim();
      nativeOk = await postAllChunks(channelId, true);
    }
  } else {
    const channelId = String(env.DISCORD_KILAUEA_REPORT_CHANNEL_ID || "1545283785803960393").trim();
    nativeOk = await postAllChunks(channelId, true);
  }

  return nativeOk;
}

export async function postKilaueaEmbedsToChannel(
  env: KilaueaDiscordEnv,
  channelId: string,
  embeds: Record<string, unknown>[],
): Promise<boolean> {
  if (!embeds.length) return false;
  return postToChannelWithFallbacks(env, channelId, { embeds, allowed_mentions: { parse: [] } }, { allowWebhook: true });
}

export async function postKilaueaEmbeds(
  env: KilaueaDiscordEnv,
  embeds: Record<string, unknown>[],
): Promise<boolean> {
  if (!embeds.length) return false;
  const payload = { embeds, allowed_mentions: { parse: [] } };
  if (!env.DB) {
    const channelId = String(env.DISCORD_KILAUEA_ALERTS_CHANNEL_ID || "").trim();
    return postToChannelWithFallbacks(env, channelId, payload);
  }
  const dests = await listGuildAlertDestinations(env.DB, env);
  if (!dests.length) return false;
  let any = false;
  for (const d of dests) {
    if (await postToChannelWithFallbacks(env, d.channel_id, payload, { allowWebhook: true })) any = true;
  }
  return any;
}

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

function interactionJson(type: number, data?: Record<string, unknown>): Response {
  const payload = data ? { type, data } : { type };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function patchDeferredInteractionMessage(
  applicationId: string,
  interactionToken: string,
  data: { content?: string; flags?: number },
): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(interactionToken)}/messages/@original`;
  await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(data),
  });
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 3)) + "...";
}

function modalField(id: string, label: string, style: 1 | 2, required = true): Record<string, unknown> {
  return { type: 4, custom_id: id, label, style, required, max_length: style === 2 ? 2000 : 200 };
}

function dataIntakeModal(): Record<string, unknown> {
  return {
    custom_id: "kilauea_data_intake",
    title: "Kilauea observation",
    components: [
      { type: 1, components: [modalField("location", "Location", 1)] },
      { type: 1, components: [modalField("observation", "What did you observe?", 2)] },
      { type: 1, components: [modalField("details", "Photo URL or extra details", 2, false)] },
    ],
  };
}

function readModalValues(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const data = body.data as Record<string, unknown> | undefined;
  const rows = Array.isArray(data?.components) ? data!.components : [];
  for (const row of rows) {
    const comps = Array.isArray((row as Record<string, unknown>).components)
      ? ((row as Record<string, unknown>).components as Record<string, unknown>[])
      : [];
    for (const c of comps) {
      const id = String(c.custom_id || "");
      if (id) out[id] = String(c.value || "").trim();
    }
  }
  return out;
}

function dataChannelId(env: KilaueaDiscordEnv): string {
  return String(
    env.DISCORD_KILAUEA_DATA_CHANNEL_ID || env.DISCORD_FEEDBACK_CHANNEL_ID || "1499515809767096443",
  ).trim();
}

async function postDataIntake(env: KilaueaDiscordEnv, user: Record<string, unknown>, fields: Record<string, string>): Promise<boolean> {
  const desc =
    `**Location:** ${fields.location || "—"}\n` +
    `**Observation:** ${fields.observation || "—"}` +
    (fields.details ? `\n**Details:** ${fields.details}` : "") +
    `\n\n**From:** ${String(user.global_name || user.username || "unknown")}${user.id ? ` (<@${user.id}>)` : ""}`;

  return postKilaueaDiscordMessage(env, dataChannelId(env), {
    embeds: [{ title: "Kīlauea data intake", description: truncate(desc, 4000), color: 0xe8590c, timestamp: new Date().toISOString() }],
    allowed_mentions: { parse: [] },
  });
}

function discordUserId(body: Record<string, unknown>): string {
  const member = body.member as Record<string, unknown> | undefined;
  const user = (member?.user as Record<string, unknown> | undefined) || (body.user as Record<string, unknown> | undefined);
  return String(user?.id || "");
}

export async function handleKilaueaDiscordInteractions(
  request: Request,
  env: KilaueaDiscordEnv,
  ctx?: ExecutionContext,
): Promise<Response> {
  const pk = String(env.DISCORD_KILAUEA_PUBLIC_KEY || "").trim();
  if (!pk) {
    return new Response(JSON.stringify({ detail: "DISCORD_KILAUEA_PUBLIC_KEY not set" }), { status: 503 });
  }

  const rawBody = await request.text();
  if (!verifyDiscordRequest(rawBody, request.headers, pk)) {
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

  if (t === 5) {
    const values = readModalValues(body);
    const user = (body.member as Record<string, unknown> | undefined)?.user as Record<string, unknown> | undefined;
    const userObj = user || (body.user as Record<string, unknown> | undefined) || {};
    const ok = await postDataIntake(env, userObj, values);
    return interactionJson(4, {
      content: ok ? "Thanks — your observation was submitted." : "Could not submit right now. Try again later.",
      flags: 64,
    });
  }

  if (t === 2) {
    const cmd = (body.data as Record<string, unknown> | undefined)?.name;
    const member = body.member as Record<string, unknown> | undefined;
    const uid = discordUserId(body);
    const appId = String(body.application_id || env.DISCORD_KILAUEA_CLIENT_ID || "").trim();
    const token = String(body.token || "").trim();

    if (cmd === "config") {
      const result = await handleConfigCommand(body, env, member);
      return interactionJson(4, result);
    }

    if (cmd === "data") {
      return interactionJson(9, dataIntakeModal());
    }

    if (cmd === "kilauea") {
      if (ctx?.waitUntil && token && appId) {
        ctx.waitUntil(
          (async () => {
            try {
              const res = await handleKilaueaCommand(body, env, member, uid);
              const payload = (await res.json()) as { type?: number; data?: { content?: string; flags?: number } };
              await patchDeferredInteractionMessage(appId, token, {
                content: payload.data?.content || "Done.",
                flags: payload.data?.flags,
              });
            } catch (e) {
              await patchDeferredInteractionMessage(appId, token, {
                content: `Kīlauea report failed: ${e instanceof Error ? e.message : String(e)}`,
                flags: 64,
              });
            }
          })(),
        );
        return interactionJson(5);
      }
      return handleKilaueaCommand(body, env, member, uid);
    }

    return interactionJson(4, { content: "Unknown command.", flags: 64 });
  }

  return interactionJson(4, { content: "Unsupported interaction.", flags: 64 });
}
