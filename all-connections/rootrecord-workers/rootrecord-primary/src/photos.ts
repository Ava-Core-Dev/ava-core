import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import { json } from "./cors";
import { sessionFromRequest } from "./primary-auth";
import { verifyWorkerOpsAdmin } from "./push";

type PhotoStatus = "pending" | "approved" | "rejected";

export interface PhotosEnv {
  DB: D1Database;
  JWT_SECRET: string;
  VOLCANO_PHOTOS: R2Bucket;
  /** Worker ops admin (`verifyWorkerOpsAdmin` / `X-RR-Push-Admin-Key`). */
  RR_PUSH_ADMIN_SECRET?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function uuid(): string {
  const g = globalThis as typeof globalThis & { crypto?: Pick<Crypto, "randomUUID"> };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now()}_${Math.random()}`;
}

function clampText(raw: unknown, max = 400): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

async function requireSession(env: PhotosEnv, request: Request) {
  return await sessionFromRequest(env, request);
}

async function isPhotoAdminByBearer(env: PhotosEnv, request: Request): Promise<boolean> {
  const sess = await requireSession(env, request);
  if (!sess) return false;
  return String(sess.email || "").trim().toLowerCase() === "rootrecord@outlook.com";
}

/**
 * Routes under `/api/photos/*`
 *
 * MVP: upload is proxied through the Worker (multipart/form-data), then stored in R2.
 * All photos require explicit approval before being listed or viewable.
 */
export async function handlePhotosRoutes(
  request: Request,
  env: PhotosEnv,
  sub: string,
  method: string
): Promise<Response | null> {
  if (!sub.startsWith("/photos")) return null;

  // Public gallery list (approved only)
  if (method === "GET" && sub === "/photos/gallery") {
    const q = new URL(request.url).searchParams;
    const lim = Math.min(60, Math.max(1, Math.floor(Number(q.get("limit") || "30") || 30)));
    const cursor = clampText(q.get("cursor"), 80);
    const rows = await env.DB.prepare(
      "SELECT id, created_at, caption FROM volcano_photo_submissions WHERE status = 'approved' AND (? IS NULL OR created_at < ?) ORDER BY created_at DESC LIMIT ?"
    )
      .bind(cursor, cursor, lim)
      .all<{ id: string; created_at: string; caption: string | null }>();
    const items = (rows.results || []).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      caption: r.caption || null,
      // Serve through the Worker so we can enforce approval.
      url: `https://api.rootrecord.info/api/photos/file/${encodeURIComponent(r.id)}`,
    }));
    const nextCursor = items.length ? items[items.length - 1].created_at : null;
    return json({ ok: true, items, next_cursor: nextCursor }, 200);
  }

  // Serve photo bytes (approved only)
  if (method === "GET" && sub.startsWith("/photos/file/")) {
    const id = sub.slice("/photos/file/".length).trim();
    if (!id) return json({ detail: "Not Found" }, 404);
    const row = await env.DB.prepare(
      "SELECT status, content_type, r2_key_original FROM volcano_photo_submissions WHERE id = ?"
    )
      .bind(id)
      .first<{ status: PhotoStatus; content_type: string | null; r2_key_original: string }>();
    if (!row) return json({ detail: "Not Found" }, 404);
    if (row.status !== "approved") return json({ detail: "Not Found" }, 404);
    const obj = await env.VOLCANO_PHOTOS.get(row.r2_key_original);
    if (!obj) return json({ detail: "Not Found" }, 404);
    return new Response(obj.body, {
      status: 200,
      headers: {
        "Content-Type": row.content_type || "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  // Auth required: upload + my submissions
  if (method === "POST" && sub === "/photos/upload") {
    const sess = await requireSession(env, request);
    if (!sess) return json({ detail: "Unauthorized" }, 401);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ detail: "Expected multipart/form-data" }, 400);
    }
    const fileEntry = form.get("file");
    if (fileEntry === null || typeof fileEntry === "string") return json({ detail: "Missing file" }, 400);
    const file = fileEntry as File;

    const contentType = file.type || "application/octet-stream";
    if (!contentType.startsWith("image/")) return json({ detail: "Only images are supported" }, 400);
    const bytes = file.size || 0;
    if (bytes <= 0) return json({ detail: "Empty file" }, 400);
    if (bytes > 20 * 1024 * 1024) return json({ detail: "Max 20MB" }, 400);

    const id = uuid();
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const key = `volcano-photos/${new Date().getUTCFullYear()}/${String(new Date().getUTCMonth() + 1).padStart(
      2,
      "0"
    )}/${id}/orig.${ext}`;

    await env.VOLCANO_PHOTOS.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType },
      customMetadata: {
        submission_id: id,
        account_id: sess.accountId,
      },
    });

    const caption = clampText(form.get("caption"), 400);
    await env.DB.prepare(
      "INSERT INTO volcano_photo_submissions (id, account_id, status, created_at, caption, content_type, bytes, r2_key_original) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)"
    )
      .bind(id, sess.accountId, nowIso(), caption, contentType, bytes, key)
      .run();

    return json({ ok: true, id, status: "pending" }, 200);
  }

  if (method === "GET" && sub === "/photos/mine") {
    const sess = await requireSession(env, request);
    if (!sess) return json({ detail: "Unauthorized" }, 401);
    const q = new URL(request.url).searchParams;
    const lim = Math.min(60, Math.max(1, Math.floor(Number(q.get("limit") || "30") || 30)));
    const rows = await env.DB.prepare(
      "SELECT id, status, created_at, caption, rejection_reason FROM volcano_photo_submissions WHERE account_id = ? ORDER BY created_at DESC LIMIT ?"
    )
      .bind(sess.accountId, lim)
      .all<{ id: string; status: PhotoStatus; created_at: string; caption: string | null; rejection_reason: string | null }>();
    const items = (rows.results || []).map((r) => ({
      id: r.id,
      status: r.status,
      created_at: r.created_at,
      caption: r.caption,
      rejection_reason: r.rejection_reason,
      url: r.status === "approved" ? `https://api.rootrecord.info/api/photos/file/${encodeURIComponent(r.id)}` : null,
    }));
    return json({ ok: true, items }, 200);
  }

  // Admin moderation (Worker ops admin key)
  if (sub.startsWith("/photos/admin")) {
    const okOps = await verifyWorkerOpsAdmin(request, env);
    const okBearer = okOps ? false : await isPhotoAdminByBearer(env, request);
    if (!okOps && !okBearer) return json({ detail: "Unauthorized" }, 401);

    if (method === "GET" && sub === "/photos/admin/pending") {
      const rows = await env.DB.prepare(
        "SELECT id, account_id, created_at, caption, content_type, bytes FROM volcano_photo_submissions WHERE status = 'pending' ORDER BY created_at DESC LIMIT 200"
      ).all();
      return json({ ok: true, items: rows.results || [] }, 200);
    }

    if (method === "POST" && sub.startsWith("/photos/admin/approve/")) {
      const id = sub.slice("/photos/admin/approve/".length).trim();
      if (!id) return json({ detail: "Missing id" }, 400);
      await env.DB.prepare(
        "UPDATE volcano_photo_submissions SET status = 'approved', reviewed_at = ?, reviewed_by = ? WHERE id = ?"
      )
        .bind(nowIso(), okOps ? "ops_admin" : "rootrecord@outlook.com", id)
        .run();
      return json({ ok: true }, 200);
    }

    if (method === "POST" && sub.startsWith("/photos/admin/reject/")) {
      const id = sub.slice("/photos/admin/reject/".length).trim();
      if (!id) return json({ detail: "Missing id" }, 400);
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const reason = clampText(body.reason, 200);
      await env.DB.prepare(
        "UPDATE volcano_photo_submissions SET status = 'rejected', reviewed_at = ?, reviewed_by = ?, rejection_reason = ? WHERE id = ?"
      )
        .bind(nowIso(), okOps ? "ops_admin" : "rootrecord@outlook.com", reason, id)
        .run();
      return json({ ok: true }, 200);
    }
  }

  return json({ detail: "Not Found" }, 404);
}

