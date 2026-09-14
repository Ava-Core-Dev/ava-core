import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import { json } from "./cors";
import { emailFromUserId, isServerGoalUser, SERVER_GOAL_EMAIL } from "./goal-constants";
import { custodialPubkeyForEmail } from "./member-custodial";
import { ensureProfile, getPublicPoster, resolveMinecraftUsername, type PublicPoster } from "./profiles";

type GalleryEnv = {
  DB: D1Database;
  GOAL_MEDIA?: R2Bucket;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_DEVELOPER_ROLE_ID?: string;
};

const MAX_SHOTS = 30;
const MAX_OPEN_REPORTS = 15;
const MAX_BYTES = 450_000;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function apiOrigin(): string {
  return "https://api-goals.rootrecord.info";
}

function shotUrl(id: string): string {
  return `${apiOrigin()}/public/gallery/${id}/image`;
}

function parseImage(body: Record<string, unknown>): { bytes: Uint8Array; contentType: string } | null {
  const raw = str(body.image_base64) || str(body.image);
  if (!raw) return null;
  const m = raw.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  const b64 = m ? m[2] : raw.replace(/\s+/g, "");
  const contentType = m ? m[1] : str(body.image_content_type) || "image/jpeg";
  try {
    const bin = atob(b64);
    if (bin.length < 32 || bin.length > MAX_BYTES) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (!contentType.startsWith("image/")) return null;
    return { bytes, contentType };
  } catch {
    return null;
  }
}

async function storeBlob(env: GalleryEnv, id: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const ct = contentType.startsWith("image/") ? contentType : "image/jpeg";
  const now = new Date().toISOString();
  if (env.GOAL_MEDIA) {
    await env.GOAL_MEDIA.put(`gallery/${id}/image`, bytes, { httpMetadata: { contentType: ct } });
  }
  await env.DB.prepare(
    `INSERT INTO rg_gallery_blobs (id, content_type, bytes, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET content_type = excluded.content_type, bytes = excluded.bytes, updated_at = excluded.updated_at`,
  )
    .bind(id, ct, bytes, now)
    .run();
}

async function readBlob(env: GalleryEnv, id: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (env.GOAL_MEDIA) {
    const obj = await env.GOAL_MEDIA.get(`gallery/${id}/image`);
    if (obj) {
      return { bytes: new Uint8Array(await obj.arrayBuffer()), contentType: obj.httpMetadata?.contentType || "image/jpeg" };
    }
  }
  const row = await env.DB.prepare(`SELECT content_type, bytes FROM rg_gallery_blobs WHERE id = ?`)
    .bind(id)
    .first<{ content_type: string; bytes: unknown }>();
  if (!row) return null;
  let bytes: Uint8Array | null = null;
  if (row.bytes instanceof Uint8Array) bytes = row.bytes;
  else if (row.bytes instanceof ArrayBuffer) bytes = new Uint8Array(row.bytes);
  if (!bytes?.byteLength) return null;
  return { bytes, contentType: row.content_type || "image/jpeg" };
}

async function isGalleryStaff(env: GalleryEnv, userId: string): Promise<boolean> {
  if (isServerGoalUser(userId)) return true;
  const email = emailFromUserId(userId);
  if (!email) return false;
  try {
    const ua = await env.DB.prepare(`SELECT account_id FROM user_accounts WHERE email = ?`)
      .bind(email)
      .first<{ account_id: string | null }>();
    const accountId = str(ua?.account_id);
    if (!accountId) return false;
    const link = await env.DB.prepare(`SELECT discord_user_id FROM discord_account_links WHERE account_id = ?`)
      .bind(accountId)
      .first<{ discord_user_id: string }>();
    const discordUserId = str(link?.discord_user_id);
    const token = String(env.DISCORD_ROOTMC_BOT_TOKEN || env.DISCORD_BOT_TOKEN || "")
      .replace(/^bot\s+/i, "")
      .trim();
    const guildId = String(env.DISCORD_GUILD_ID || "").trim();
    const rid = String(env.DISCORD_DEVELOPER_ROLE_ID || "").trim();
    if (!token || !guildId || !discordUserId || !rid) return false;
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(discordUserId)}`,
      { headers: { Authorization: `Bot ${token}`, "User-Agent": "RootRecordGallery (staff role)" } },
    );
    if (!res.ok) return false;
    const member = (await res.json().catch(() => ({}))) as { roles?: unknown };
    const roles = Array.isArray(member.roles) ? member.roles.map((r) => String(r)) : [];
    return roles.includes(rid);
  } catch {
    return false;
  }
}

function publicShot(row: Record<string, unknown>, poster?: PublicPoster | null) {
  return {
    id: row.id,
    caption: row.caption || "",
    created_at: row.created_at,
    image_url: shotUrl(String(row.id)),
    posted_by: poster || null,
  };
}

export async function handlePublicGalleryList(env: GalleryEnv, slugFilter?: string): Promise<Response> {
  let emailFilter = "";
  if (slugFilter) {
    const prof = await env.DB.prepare(`SELECT email FROM rg_profiles WHERE slug = ?`)
      .bind(slugFilter.toLowerCase())
      .first<{ email: string }>();
    if (!prof) return json({ shots: [], slug: slugFilter });
    emailFilter = prof.email;
  }
  const sql = emailFilter
    ? `SELECT * FROM rg_gallery WHERE kind = 'shot' AND status = 'public' AND email = ? ORDER BY created_at DESC LIMIT 80`
    : `SELECT * FROM rg_gallery WHERE kind = 'shot' AND status = 'public' ORDER BY created_at DESC LIMIT 80`;
  const rows = emailFilter
    ? await env.DB.prepare(sql).bind(emailFilter).all()
    : await env.DB.prepare(sql).all();
  const list = (rows.results ?? []) as Record<string, unknown>[];
  const posters = new Map<string, PublicPoster>();
  const shots = [];
  for (const row of list) {
    const email = str(row.email).toLowerCase();
    if (!posters.has(email)) posters.set(email, await getPublicPoster(env, email));
    shots.push(publicShot(row, posters.get(email)));
  }
  return json({ shots, slug: slugFilter || null });
}

export async function handlePublicGalleryImage(env: GalleryEnv, id: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT id, kind, status FROM rg_gallery WHERE id = ?`,
  )
    .bind(id)
    .first<{ id: string; kind: string; status: string }>();
  if (!row || row.kind !== "shot" || row.status !== "public") return json({ detail: "Not found." }, 404);
  const img = await readBlob(env, id);
  if (!img) return json({ detail: "Not found." }, 404);
  return new Response(img.bytes, {
    headers: { "content-type": img.contentType, "cache-control": "public, max-age=86400" },
  });
}

export async function handlePublicPlayer(env: GalleryEnv, slugRaw: string): Promise<Response> {
  const slug = decodeURIComponent(slugRaw).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  if (!slug) return json({ detail: "Not found." }, 404);
  const row = await env.DB.prepare(`SELECT * FROM rg_profiles WHERE slug = ?`).bind(slug).first<Record<string, unknown>>();
  if (!row) return json({ detail: "Not found." }, 404);
  const poster = await getPublicPoster(env, str(row.email));
  const shotsRes = await handlePublicGalleryList(env, slug);
  const body = (await shotsRes.json()) as { shots?: unknown[] };
  return json({
    profile: {
      ...poster,
      bio: str(row.bio),
      minecraft_username: str(row.minecraft_username) || null,
      solana_address: await custodialPubkeyForEmail(env.DB, str(row.email)),
    },
    shots: body.shots || [],
  });
}

export async function handleGalleryMine(
  request: Request,
  env: GalleryEnv,
  userId: string,
): Promise<Response> {
  if (!userId.startsWith("user:")) return json({ detail: "Sign in to use the gallery." }, 401);
  const email = emailFromUserId(userId);
  const staff = await isGalleryStaff(env, userId);
  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT id, kind, caption, accused_minecraft, status, created_at FROM rg_gallery WHERE email = ? ORDER BY created_at DESC LIMIT 80`,
    )
      .bind(email)
      .all();
    const items = (rows.results ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      const kind = str(row.kind);
      return {
        id: row.id,
        kind,
        caption: row.caption || "",
        accused_minecraft: kind === "report" ? row.accused_minecraft || "" : undefined,
        status: row.status,
        created_at: row.created_at,
        image_url: kind === "shot" && row.status === "public" ? shotUrl(String(row.id)) : `/api/gallery/${row.id}/image`,
      };
    });
    return json({ items, staff, email: email === SERVER_GOAL_EMAIL ? email : undefined });
  }
  if (request.method !== "POST") return json({ detail: "Method not allowed" }, 405);

  const body = record(await request.json().catch(() => ({})));
  const kind = str(body.kind) === "report" ? "report" : "shot";
  const img = parseImage(body);
  if (!img) return json({ detail: "Screenshot required (image, under ~400KB after compress)." }, 400);
  const caption = str(body.caption).slice(0, 280);
  await ensureProfile(env, email);

  if (kind === "shot") {
    const n = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM rg_gallery WHERE email = ? AND kind = 'shot' AND status != 'deleted'`,
    )
      .bind(email)
      .first<{ c: number }>();
    if (Number(n?.c || 0) >= MAX_SHOTS) {
      return json({ detail: `Gallery limit is ${MAX_SHOTS} screenshots.` }, 400);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await storeBlob(env, id, img.bytes, img.contentType);
    await env.DB.prepare(
      `INSERT INTO rg_gallery (id, email, kind, caption, status, content_type, created_at) VALUES (?, ?, 'shot', ?, 'public', ?, ?)`,
    )
      .bind(id, email, caption || null, img.contentType, now)
      .run();
    return json({ ok: true, id, kind: "shot", image_url: shotUrl(id) }, 201);
  }

  const accusedName = str(body.accused_minecraft);
  if (!accusedName) return json({ detail: "Name the player this report is about." }, 400);
  const resolved = await resolveMinecraftUsername(accusedName);
  const n = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM rg_gallery WHERE email = ? AND kind = 'report' AND status = 'open'`,
  )
    .bind(email)
    .first<{ c: number }>();
  if (Number(n?.c || 0) >= MAX_OPEN_REPORTS) {
    return json({ detail: `You already have ${MAX_OPEN_REPORTS} open reports.` }, 400);
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await storeBlob(env, id, img.bytes, img.contentType);
  await env.DB.prepare(
    `INSERT INTO rg_gallery (id, email, kind, caption, accused_minecraft, accused_uuid, status, content_type, created_at)
     VALUES (?, ?, 'report', ?, ?, ?, 'open', ?, ?)`,
  )
    .bind(id, email, caption || null, (resolved?.username || accusedName).slice(0, 16), resolved?.uuid || null, img.contentType, now)
    .run();
  return json({ ok: true, id, kind: "report" }, 201);
}

export async function handleGalleryReports(
  request: Request,
  env: GalleryEnv,
  userId: string,
): Promise<Response> {
  if (!(await isGalleryStaff(env, userId))) return json({ detail: "Staff only." }, 403);
  if (request.method !== "GET") return json({ detail: "Method not allowed" }, 405);
  const rows = await env.DB.prepare(
    `SELECT id, email, caption, accused_minecraft, accused_uuid, status, created_at FROM rg_gallery WHERE kind = 'report' ORDER BY created_at DESC LIMIT 80`,
  ).all();
  const items = [];
  for (const r of rows.results ?? []) {
    const row = r as Record<string, unknown>;
    items.push({
      id: row.id,
      caption: row.caption || "",
      accused_minecraft: row.accused_minecraft || "",
      accused_uuid: row.accused_uuid || null,
      status: row.status,
      created_at: row.created_at,
      reporter: await getPublicPoster(env, str(row.email)),
      image_url: `/api/gallery/${row.id}/image`,
    });
  }
  return json({ reports: items });
}

export async function handleGalleryItem(
  request: Request,
  env: GalleryEnv,
  userId: string,
  id: string,
): Promise<Response> {
  if (!userId.startsWith("user:")) return json({ detail: "Sign in." }, 401);
  const email = emailFromUserId(userId);
  const staff = await isGalleryStaff(env, userId);
  const row = await env.DB.prepare(`SELECT * FROM rg_gallery WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!row) return json({ detail: "Not found." }, 404);
  const owner = str(row.email).toLowerCase() === email;
  const isReport = str(row.kind) === "report";

  if (request.method === "GET") {
    if (isReport && !staff && !owner) return json({ detail: "Not found." }, 404);
    if (!isReport && str(row.status) !== "public" && !owner && !staff) return json({ detail: "Not found." }, 404);
    const img = await readBlob(env, id);
    if (!img) return json({ detail: "Not found." }, 404);
    return new Response(img.bytes, {
      headers: { "content-type": img.contentType, "cache-control": "private, max-age=60" },
    });
  }

  if (request.method === "DELETE") {
    if (!owner && !staff) return json({ detail: "Not found." }, 404);
    await env.DB.prepare(`UPDATE rg_gallery SET status = 'deleted' WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  }

  if (request.method === "PATCH") {
    const body = record(await request.json().catch(() => ({})));
    if (isReport) {
      if (!staff) return json({ detail: "Staff only." }, 403);
      const status = str(body.status);
      if (!["open", "reviewed", "dismissed"].includes(status)) {
        return json({ detail: "status must be open, reviewed, or dismissed." }, 400);
      }
      await env.DB.prepare(`UPDATE rg_gallery SET status = ? WHERE id = ?`).bind(status, id).run();
      return json({ ok: true, status });
    }
    if (!owner) return json({ detail: "Not found." }, 404);
    if (body.status === "hidden" || body.status === "public") {
      await env.DB.prepare(`UPDATE rg_gallery SET status = ? WHERE id = ? AND kind = 'shot'`).bind(str(body.status), id).run();
    }
    if (body.caption != null) {
      await env.DB.prepare(`UPDATE rg_gallery SET caption = ? WHERE id = ?`).bind(str(body.caption).slice(0, 280) || null, id).run();
    }
    return json({ ok: true });
  }

  return json({ detail: "Method not allowed" }, 405);
}
