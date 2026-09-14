/**
 * RootMC plot blueprints  -  upload to R2, signed download for linked Pro/Lifetime members.
 */

import type { R2Bucket } from "@cloudflare/workers-types";

import { readUserAccountAccessFlags } from "./accounts";
import { json } from "./cors";
import { validateServerAuth } from "./rootstat-minecraft";

export type BlueprintEnv = {
  DB: D1Database;
  ASSETS?: R2Bucket;
  JWT_SECRET?: string;
  SITE_URL?: string;
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function slugTown(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_|_$/g, "").slice(0, 48) || "town";
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function downloadToken(env: BlueprintEnv, blueprintId: string): Promise<string> {
  const secret = str(env.JWT_SECRET) || "rootmc-blueprint";
  return (await sha256Hex(`${secret}:${blueprintId}`)).slice(0, 32);
}

export async function handleRootMcBlueprintRoutes(
  request: Request,
  env: BlueprintEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (!sub.startsWith("/rootmc/blueprint")) {
    return null;
  }

  if (method === "POST" && sub === "/rootmc/blueprint/upload") {
    const server = await validateServerAuth(env, request);
    if (server instanceof Response) return server;
    if (!env.ASSETS) {
      return json({ ok: false, detail: "R2 not configured on worker" }, 503);
    }

    let body: {
      account_id?: string;
      minecraft_uuid?: string;
      minecraft_username?: string;
      town_name?: string;
      plot_x?: number;
      plot_z?: number;
      world_name?: string;
      chunk_x?: number;
      chunk_z?: number;
      anchor_x?: number;
      anchor_y?: number;
      anchor_z?: number;
      content_base64?: string;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ ok: false, detail: "invalid json" }, 400);
    }

    const accountId = str(body.account_id);
    const minecraftUuid = str(body.minecraft_uuid).toLowerCase();
    const townName = str(body.town_name);
    const worldName = str(body.world_name);
    const plotX = Number(body.plot_x);
    const plotZ = Number(body.plot_z);
    const chunkX = Number(body.chunk_x);
    const chunkZ = Number(body.chunk_z);
    const b64 = str(body.content_base64);
    if (!accountId || !minecraftUuid || !townName || !worldName || !b64 || Number.isNaN(plotX) || Number.isNaN(plotZ)) {
      return json({ ok: false, detail: "missing required fields" }, 400);
    }

    let bytes: Uint8Array;
    try {
      const raw = atob(b64);
      bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    } catch {
      return json({ ok: false, detail: "invalid content_base64" }, 400);
    }

    const maxBytes = 12 * 1024 * 1024;
    if (bytes.byteLength <= 0 || bytes.byteLength > maxBytes) {
      return json({ ok: false, detail: "schematic size out of range" }, 400);
    }

    const id = crypto.randomUUID();
    const fileName = `${slugTown(townName)}_${plotX}_${plotZ}.schem`;
    const r2Key = `blueprints/${server.serverId}/${id}/${fileName}`;
    const token = await downloadToken(env, id);
    const now = new Date().toISOString();

    await env.ASSETS.put(r2Key, bytes, {
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: { town: townName, plot_x: String(plotX), plot_z: String(plotZ) },
    });

    await env.DB.prepare(
      `INSERT INTO rootmc_blueprints
         (id, server_id, account_id, minecraft_uuid, minecraft_username, town_name, plot_x, plot_z,
          world_name, chunk_x, chunk_z, anchor_x, anchor_y, anchor_z, r2_key, file_name, size_bytes, download_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        server.serverId,
        accountId,
        minecraftUuid,
        str(body.minecraft_username) || null,
        townName,
        plotX,
        plotZ,
        worldName,
        chunkX,
        chunkZ,
        Number(body.anchor_x) || 0,
        Number(body.anchor_y) || 64,
        Number(body.anchor_z) || 0,
        r2Key,
        fileName,
        bytes.byteLength,
        token,
        now,
      )
      .run();

    const downloadUrl = `https://api.rootmc.info/api/rootmc/blueprint/file/${encodeURIComponent(id)}?t=${token}`;

    return json({
      ok: true,
      id,
      file_name: fileName,
      download_url: downloadUrl,
      size_bytes: bytes.byteLength,
    });
  }

  const fileMatch = sub.match(/^\/rootmc\/blueprint\/file\/([^/]+)$/);
  if (method === "GET" && fileMatch) {
    const id = decodeURIComponent(fileMatch[1]);
    const token = str(new URL(request.url).searchParams.get("t"));
    if (!id || !token) {
      return json({ detail: "missing id or token" }, 400);
    }
    if (!env.ASSETS) {
      return json({ detail: "R2 not configured" }, 503);
    }

    const row = await env.DB.prepare(
      `SELECT r2_key, file_name, download_token FROM rootmc_blueprints WHERE id = ? LIMIT 1`,
    )
      .bind(id)
      .first<{ r2_key: string; file_name: string; download_token: string }>();

    if (!row?.r2_key) {
      return json({ detail: "not found" }, 404);
    }
    if (token !== row.download_token) {
      return json({ detail: "invalid token" }, 403);
    }

    const obj = await env.ASSETS.get(row.r2_key);
    if (!obj) {
      return json({ detail: "file missing" }, 404);
    }

    const headers = new Headers();
    headers.set("Content-Type", "application/octet-stream");
    headers.set("Content-Disposition", `attachment; filename="${row.file_name.replace(/"/g, "")}"`);
    headers.set("Cache-Control", "private, max-age=3600");
    return new Response(obj.body, { status: 200, headers });
  }

  return null;
}

/** Pro/Lifetime flags for in-game blueprint gate. */
export async function blueprintMemberFlags(
  db: D1Database,
  email: string,
): Promise<{ pro_unlocked: boolean; life_member: boolean; blueprint_eligible: boolean }> {
  const flags = await readUserAccountAccessFlags(db, email);
  const pro = Boolean(flags?.pro_unlocked);
  const life = Boolean(flags?.life_member);
  return { pro_unlocked: pro, life_member: life, blueprint_eligible: pro || life };
}
