import { json } from "../cors";
import type { Env } from "../realm-router";

function str(value: string | null | undefined): string {
  return String(value || "").trim();
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function g2ServerHeaders(request: Request): { realmId: string; secret: string } {
  return {
    realmId: str(request.headers.get("X-RootStat-Server-Id")),
    secret: str(request.headers.get("X-RootStat-Server-Secret")),
  };
}

export async function validateG2ServerAuth(
  env: Env,
  request: Request,
): Promise<{ realmId: string } | Response> {
  const { realmId, secret } = g2ServerHeaders(request);
  if (!realmId || !secret) {
    return json({ detail: "Missing X-RootStat-Server-Id or X-RootStat-Server-Secret." }, 401);
  }

  const devId = str(env.G2_DEV_REALM_ID);
  const devSecret = str(env.G2_DEV_REALM_SECRET);
  if (devId && devSecret && realmId === devId && secret === devSecret) {
    return { realmId };
  }

  const row = await env.DB.prepare(
    "SELECT secret_hash FROM g2_realm_credentials WHERE realm_id = ? LIMIT 1",
  )
    .bind(realmId)
    .first<{ secret_hash: string }>();

  if (!row?.secret_hash) {
    return json({ detail: "Unknown realm. Register credentials in plugins/RootMC/cloud.yml." }, 403);
  }

  const hash = await sha256Hex(secret);
  if (hash !== row.secret_hash) {
    return json({ detail: "Invalid realm secret." }, 403);
  }

  return { realmId };
}
