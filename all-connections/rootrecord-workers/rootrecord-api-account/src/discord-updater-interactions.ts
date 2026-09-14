import type { ExecutionContext } from "@cloudflare/workers-types";
import nacl from "tweetnacl";

import { handleRootUpdatesSlashCommand, type RootUpdatesDiscordEnv } from "./discord-root-updates";

export type DiscordUpdaterEnv = RootUpdatesDiscordEnv & {
  DISCORD_PUBLIC_KEY?: string;
};

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

function interactionJson(type: number, data?: { content?: string; flags?: number }): Response {
  const payload = data ? { type, data } : { type };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Root Record Global Updater — `/root` setup commands only. */
export async function handleDiscordUpdaterInteractions(
  request: Request,
  env: DiscordUpdaterEnv,
  _ctx?: ExecutionContext,
): Promise<Response> {
  const pk = String(env.DISCORD_PUBLIC_KEY || "").trim();
  if (!pk) {
    return new Response(JSON.stringify({ detail: "DISCORD_PUBLIC_KEY is not set on this Worker." }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
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

  if (t === 2) {
    const data = body.data as Record<string, unknown> | undefined;
    const name = String(data?.name || "").trim().toLowerCase();
    if (name !== "root") {
      return interactionJson(4, { flags: 64 });
    }
    return handleRootUpdatesSlashCommand(body, env);
  }

  return interactionJson(4, { flags: 64 });
}
