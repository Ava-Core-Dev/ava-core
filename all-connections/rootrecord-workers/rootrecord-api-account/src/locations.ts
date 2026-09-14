import type { D1Database } from "@cloudflare/workers-types";
import { json } from "./cors";
import { resolveUserId } from "./auth";

export async function handleLocations(
  request: Request,
  env: { DB: D1Database; JWT_SECRET: string },
  subpath: string,
  method: string
): Promise<Response | null> {
  const locMatch = subpath.match(/^\/locations(?:\/([^/]+))?$/);
  if (!locMatch) return null;

  const user = await resolveUserId(request, env);
  if (user instanceof Response) return user;
  const userId = user;

  const locationId = locMatch[1];

  if (method === "GET" && subpath === "/locations") {
    const rs = await env.DB.prepare(
      "SELECT id, user_id, name, latitude, longitude, created_at FROM rrwm_locations WHERE user_id = ? ORDER BY created_at ASC"
    )
      .bind(userId)
      .all();
    return json(rs.results || [], 200);
  }

  if (method === "POST" && subpath === "/locations") {
    let body: { name?: string; latitude?: number; longitude?: number };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON" }, 400);
    }
    const name = (body.name || "").trim();
    if (!name) return json({ detail: "Location name is required." }, 400);
    const lat = Number(body.latitude);
    const lon = Number(body.longitude);
    if (!(-90 <= lat && lat <= 90) || !(-180 <= lon && lon <= 180)) {
      return json({ detail: "Latitude/longitude out of range." }, 400);
    }
    const id = crypto.randomUUID();
    const created_at = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO rrwm_locations (id, user_id, name, latitude, longitude, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(id, userId, name, lat, lon, created_at)
      .run();
    return json({ id, user_id: userId, name, latitude: lat, longitude: lon, created_at }, 200);
  }

  if (!locationId) return null;

  if (method === "PATCH") {
    let body: { name?: string; latitude?: number; longitude?: number };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON" }, 400);
    }
    const updates: string[] = [];
    const vals: unknown[] = [];
    if (body.name !== undefined) {
      updates.push("name = ?");
      vals.push(String(body.name).trim());
    }
    if (body.latitude !== undefined) {
      updates.push("latitude = ?");
      vals.push(Number(body.latitude));
    }
    if (body.longitude !== undefined) {
      updates.push("longitude = ?");
      vals.push(Number(body.longitude));
    }
    if (!updates.length) return json({ detail: "No fields to update." }, 400);
    vals.push(locationId, userId);
    const q = `UPDATE rrwm_locations SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`;
    await env.DB.prepare(q)
      .bind(...vals)
      .run();
    const row = await env.DB.prepare(
      "SELECT id, user_id, name, latitude, longitude, created_at FROM rrwm_locations WHERE id = ? AND user_id = ?"
    )
      .bind(locationId, userId)
      .first();
    if (!row) return json({ detail: "Location not found." }, 404);
    return json(row, 200);
  }

  if (method === "DELETE") {
    const r = await env.DB.prepare("DELETE FROM rrwm_locations WHERE id = ? AND user_id = ?")
      .bind(locationId, userId)
      .run();
    const changes = Number((r.meta as { changes?: number }).changes ?? 0);
    if (!changes) return json({ detail: "Location not found." }, 404);
    return json({ ok: true }, 200);
  }

  return null;
}
