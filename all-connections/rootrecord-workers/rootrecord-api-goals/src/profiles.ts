import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import { json } from "./cors";
import { emailFromUserId, isServerGoalUser, SERVER_GOAL_EMAIL } from "./goal-constants";
import { canPostPublicGoals } from "./goals-limits";
import { readUserAccountAccessFlags } from "./accounts";
import { accountIdForEmail, custodialPubkeyForEmail, provisionCustodialWalletIfMissing } from "./member-custodial";

type ProfileEnv = {
  DB: D1Database;
  GOAL_MEDIA?: R2Bucket;
  INTERNAL_WALLET_ENC_KEY_B64?: string;
};

export type PublicPoster = {
  slug: string;
  display_name: string;
  avatar_url: string;
  minecraft_username: string | null;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function apiOrigin(): string {
  return "https://api-goals.rootrecord.info";
}

export function profileAvatarUrl(slug: string): string {
  return `${apiOrigin()}/public/profile/${encodeURIComponent(slug)}/avatar`;
}

function slugify(raw: string): string {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return s || "member";
}

function undashUuid(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

function dashUuid(uuid: string): string {
  const h = undashUuid(uuid);
  if (h.length !== 32) return uuid;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function parseAvatarPayload(body: Record<string, unknown>): { bytes: Uint8Array; contentType: string } | null {
  const raw = str(body.image_base64) || str(body.avatar_base64) || str(body.image);
  if (!raw) return null;
  const m = raw.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  const b64 = m ? m[2] : raw.replace(/\s+/g, "");
  const contentType = m ? m[1] : str(body.image_content_type) || "image/png";
  try {
    const bin = atob(b64);
    if (bin.length < 32 || bin.length > 450_000) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (!contentType.startsWith("image/")) return null;
    return { bytes, contentType };
  } catch {
    return null;
  }
}

function publicPoster(row: Record<string, unknown>): PublicPoster {
  const slug = str(row.slug) || "member";
  return {
    slug,
    display_name: str(row.display_name) || slug,
    avatar_url: profileAvatarUrl(slug),
    minecraft_username: str(row.minecraft_username) || null,
  };
}

async function uniqueSlug(db: D1Database, base: string, email: string): Promise<string> {
  const want = slugify(base);
  const taken = await db
    .prepare(`SELECT email FROM rg_profiles WHERE slug = ?`)
    .bind(want)
    .first<{ email: string }>();
  if (!taken || taken.email === email) return want;
  return `${want}-${crypto.randomUUID().slice(0, 6)}`;
}

async function linkedMinecraft(
  db: D1Database,
  email: string,
): Promise<{ uuid: string; username: string } | null> {
  try {
    const ua = await db
      .prepare(`SELECT account_id FROM user_accounts WHERE email = ?`)
      .bind(email)
      .first<{ account_id: string | null }>();
    const row =
      (await db
        .prepare(
          `SELECT minecraft_uuid, minecraft_username FROM rootstat_minecraft_links WHERE lower(email) = ? LIMIT 1`,
        )
        .bind(email)
        .first<{ minecraft_uuid: string; minecraft_username: string }>()) ||
      (ua?.account_id
        ? await db
            .prepare(
              `SELECT minecraft_uuid, minecraft_username FROM rootstat_minecraft_links WHERE account_id = ? LIMIT 1`,
            )
            .bind(ua.account_id)
            .first<{ minecraft_uuid: string; minecraft_username: string }>()
        : null);
    if (!row?.minecraft_uuid) return null;
    return { uuid: undashUuid(row.minecraft_uuid), username: str(row.minecraft_username) };
  } catch {
    return null;
  }
}

export async function resolveMinecraftUsername(
  name: string,
): Promise<{ uuid: string; username: string } | null> {
  const n = str(name);
  if (!n || n.length < 2 || n.length > 16) return null;
  try {
    const res = await fetch(`https://api.ashcon.app/mojang/v2/user/${encodeURIComponent(n)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { uuid?: string; username?: string };
    const uuid = undashUuid(str(data.uuid));
    if (uuid.length !== 32) return null;
    return { uuid, username: str(data.username) || n };
  } catch {
    return null;
  }
}

export async function ensureProfile(env: ProfileEnv, emailRaw: string): Promise<Record<string, unknown>> {
  const email = emailRaw.trim().toLowerCase();
  if (!email) throw new Error("email required");
  const existing = await env.DB.prepare(`SELECT * FROM rg_profiles WHERE email = ?`)
    .bind(email)
    .first<Record<string, unknown>>();
  const mc = await linkedMinecraft(env.DB, email);
  const now = new Date().toISOString();
  if (existing) {
    if (mc && !str(existing.minecraft_uuid)) {
      await env.DB.prepare(
        `UPDATE rg_profiles SET minecraft_uuid = ?, minecraft_username = COALESCE(minecraft_username, ?), updated_at = ? WHERE email = ?`,
      )
        .bind(mc.uuid, mc.username, now, email)
        .run();
      return { ...existing, minecraft_uuid: mc.uuid, minecraft_username: str(existing.minecraft_username) || mc.username };
    }
    return existing;
  }

  const isAva = email === SERVER_GOAL_EMAIL;
  const display = isAva ? "Ava" : mc?.username || email.split("@")[0] || "Member";
  const slug = await uniqueSlug(env.DB, isAva ? "ava" : display, email);
  await env.DB.prepare(
    `INSERT INTO rg_profiles (email, slug, display_name, bio, avatar_kind, minecraft_uuid, minecraft_username, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'auto', ?, ?, ?, ?)`,
  )
    .bind(
      email,
      slug,
      display.slice(0, 40),
      isAva ? "Ava Ivy — public Root Record server goals live here." : null,
      mc?.uuid || null,
      mc?.username || null,
      now,
      now,
    )
    .run();
  const row = await env.DB.prepare(`SELECT * FROM rg_profiles WHERE email = ?`).bind(email).first<Record<string, unknown>>();
  return row || { email, slug, display_name: display };
}

export async function getPublicPoster(env: ProfileEnv, emailRaw: string | null | undefined): Promise<PublicPoster> {
  const email = str(emailRaw).toLowerCase();
  if (!email) {
    return { slug: "ava", display_name: "Ava", avatar_url: profileAvatarUrl("ava"), minecraft_username: null };
  }
  try {
    const row = await ensureProfile(env, email);
    return publicPoster(row);
  } catch {
    const slug = email === SERVER_GOAL_EMAIL ? "ava" : "member";
    return {
      slug,
      display_name: email === SERVER_GOAL_EMAIL ? "Ava" : "Member",
      avatar_url: profileAvatarUrl(slug),
      minecraft_username: null,
    };
  }
}

export async function postersForRows(env: ProfileEnv, rows: Record<string, unknown>[]): Promise<Map<string, PublicPoster>> {
  const emails = [
    ...new Set(
      rows
        .map((r) =>
          Boolean(r.is_server_goal)
            ? SERVER_GOAL_EMAIL
            : str(r.posted_by_email) || emailFromUserId(String(r.user_id || "")),
        )
        .map((e) => e.toLowerCase())
        .filter(Boolean),
    ),
  ];
  const out = new Map<string, PublicPoster>();
  for (const email of emails) {
    out.set(email, await getPublicPoster(env, email));
  }
  return out;
}

export function posterEmailForRow(row: Record<string, unknown>): string {
  if (Boolean(row.is_server_goal)) return SERVER_GOAL_EMAIL;
  return (
    str(row.posted_by_email) || emailFromUserId(String(row.user_id || ""))
  ).toLowerCase();
}

async function storeAvatar(
  env: ProfileEnv,
  email: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const ct = contentType.startsWith("image/") ? contentType : "image/jpeg";
  const now = new Date().toISOString();
  if (env.GOAL_MEDIA) {
    await env.GOAL_MEDIA.put(`profiles/${email}/avatar`, bytes, { httpMetadata: { contentType: ct } });
  }
  await env.DB.prepare(
    `INSERT INTO rg_profile_avatars (email, content_type, bytes, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET content_type = excluded.content_type, bytes = excluded.bytes, updated_at = excluded.updated_at`,
  )
    .bind(email, ct, bytes, now)
    .run();
}

async function readUploadedAvatar(
  env: ProfileEnv,
  email: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (env.GOAL_MEDIA) {
    const obj = await env.GOAL_MEDIA.get(`profiles/${email}/avatar`);
    if (obj) {
      return { bytes: new Uint8Array(await obj.arrayBuffer()), contentType: obj.httpMetadata?.contentType || "image/png" };
    }
  }
  const row = await env.DB.prepare(`SELECT content_type, bytes FROM rg_profile_avatars WHERE email = ?`)
    .bind(email)
    .first<{ content_type: string; bytes: unknown }>();
  if (!row) return null;
  let bytes: Uint8Array | null = null;
  if (row.bytes instanceof Uint8Array) bytes = row.bytes;
  else if (row.bytes instanceof ArrayBuffer) bytes = new Uint8Array(row.bytes);
  if (!bytes?.byteLength) return null;
  return { bytes, contentType: row.content_type || "image/png" };
}

function initialsSvg(name: string): Uint8Array {
  const initials = String(name || "A")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .filter((c) => /[A-Z0-9]/.test(c))
    .join("") || "A";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect fill="#121a26" width="128" height="128"/><text x="64" y="76" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="48" font-weight="700" fill="#e6b84d">${initials}</text></svg>`;
  return new TextEncoder().encode(svg);
}

export async function handleProfileAvatarGet(env: ProfileEnv, slugRaw: string): Promise<Response> {
  const slug = decodeURIComponent(slugRaw).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  if (!slug) return json({ detail: "Not found." }, 404);
  let row = await env.DB.prepare(`SELECT * FROM rg_profiles WHERE slug = ?`).bind(slug).first<Record<string, unknown>>();
  if (!row && slug === "ava") {
    row = await ensureProfile(env, SERVER_GOAL_EMAIL);
  }
  if (!row) return json({ detail: "Not found." }, 404);
  const email = str(row.email);
  const kind = str(row.avatar_kind) || "auto";
  if (kind === "upload") {
    const up = await readUploadedAvatar(env, email);
    if (up) {
      return new Response(up.bytes, {
        headers: { "content-type": up.contentType, "cache-control": "public, max-age=3600" },
      });
    }
  }
  const uuid = str(row.minecraft_uuid);
  if (uuid.length === 32) {
    return Response.redirect(`https://mc-heads.net/avatar/${dashUuid(uuid)}/128`, 302);
  }
  const svg = initialsSvg(str(row.display_name));
  return new Response(svg, {
    headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}

async function profileWalletPubkey(env: ProfileEnv, email: string): Promise<string | null> {
  const existing = await custodialPubkeyForEmail(env.DB, email);
  if (existing) return existing;
  const accountId = await accountIdForEmail(env.DB, email);
  if (!accountId || !env.INTERNAL_WALLET_ENC_KEY_B64) return null;
  const made = await provisionCustodialWalletIfMissing(env, accountId);
  if ("error" in made) return null;
  return made.pubkey;
}

export async function handleProfileMe(
  request: Request,
  env: ProfileEnv,
  userId: string,
): Promise<Response> {
  if (!userId.startsWith("user:")) return json({ detail: "Sign in to edit your profile." }, 401);
  const email = emailFromUserId(userId);
  if (request.method === "GET") {
    const row = await ensureProfile(env, email);
    const canPost = await canPostPublicGoals(env.DB, userId);
    const flags = await readUserAccountAccessFlags(env.DB, email).catch(() => null);
    return json({
      profile: {
        ...publicPoster(row),
        bio: str(row.bio),
        avatar_kind: str(row.avatar_kind) || "auto",
        minecraft_uuid: str(row.minecraft_uuid) || null,
        minecraft_username: str(row.minecraft_username) || null,
        email,
        custodial_wallet_pubkey: await profileWalletPubkey(env, email),
      },
      can_post_goals: canPost,
      life_member: Boolean(flags?.life_member) || isServerGoalUser(userId),
      pro_unlocked: Boolean(flags?.pro_unlocked) || isServerGoalUser(userId),
      is_operator: isServerGoalUser(userId),
    });
  }
  if (request.method !== "PATCH") return json({ detail: "Method not allowed" }, 405);

  const body = record(await request.json().catch(() => ({})));
  const row = await ensureProfile(env, email);
  const now = new Date().toISOString();
  let display = body.display_name != null ? str(body.display_name).slice(0, 40) : str(row.display_name);
  if (!display) display = email === SERVER_GOAL_EMAIL ? "Ava" : email.split("@")[0] || "Member";
  const bio = body.bio != null ? str(body.bio).slice(0, 280) : str(row.bio);
  let mcUuid = str(row.minecraft_uuid);
  let mcName = str(row.minecraft_username);
  if (body.minecraft_username != null) {
    const want = str(body.minecraft_username);
    if (!want) {
      mcUuid = "";
      mcName = "";
    } else {
      const resolved = await resolveMinecraftUsername(want);
      if (!resolved) return json({ detail: "Minecraft username not found." }, 400);
      mcUuid = resolved.uuid;
      mcName = resolved.username;
    }
  }
  let kind = str(body.avatar_kind) || str(row.avatar_kind) || "auto";
  const img = parseAvatarPayload(body);
  if (img) {
    await storeAvatar(env, email, img.bytes, img.contentType);
    kind = "upload";
  } else if (str(body.avatar_kind) === "auto" || str(body.avatar_kind) === "minecraft") {
    kind = mcUuid ? "minecraft" : "auto";
  }
  if (kind === "minecraft" && !mcUuid) {
    const linked = await linkedMinecraft(env.DB, email);
    if (linked) {
      mcUuid = linked.uuid;
      mcName = mcName || linked.username;
    }
  }

  await env.DB.prepare(
    `UPDATE rg_profiles SET display_name = ?, bio = ?, avatar_kind = ?, minecraft_uuid = ?, minecraft_username = ?, updated_at = ? WHERE email = ?`,
  )
    .bind(display, bio || null, kind, mcUuid || null, mcName || null, now, email)
    .run();
  const next = await env.DB.prepare(`SELECT * FROM rg_profiles WHERE email = ?`).bind(email).first<Record<string, unknown>>();
  return json({
    profile: {
      ...publicPoster(next || row),
      bio,
      avatar_kind: kind,
      minecraft_uuid: mcUuid || null,
      minecraft_username: mcName || null,
      email,
      custodial_wallet_pubkey: await custodialPubkeyForEmail(env.DB, email),
    },
    can_post_goals: await canPostPublicGoals(env.DB, userId),
    is_operator: isServerGoalUser(userId),
  });
}
