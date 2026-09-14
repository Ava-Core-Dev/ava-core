import bs58 from "bs58";

import { json } from "./cors";

import { extractAuthToken, sessionFromRequest, type AuthEnv } from "./primary-auth";

/** First line must match client (`portalAccountApi` / AccountPageClient). */
export const SOLANA_LINK_WALLET_MESSAGE_PREFIX = "RootRecord account wallet link";

export function parseSolanaLinkWalletMessage(msg: string): {
  accountId: string;
  wallet: string;
  issuedIso: string;
} | null {
  const lines = msg.trim().split(/\r?\n/).map((l) => l.trim());
  if (lines.length < 4 || lines[0] !== SOLANA_LINK_WALLET_MESSAGE_PREFIX) return null;
  const acc = lines[1]?.match(/^account_id:(.+)$/);
  const wal = lines[2]?.match(/^wallet:(.+)$/);
  const iss = lines[3]?.match(/^issued:(.+)$/);
  if (!acc || !wal || !iss) return null;
  return { accountId: acc[1]!.trim(), wallet: wal[1]!.trim(), issuedIso: iss[1]!.trim() };
}

async function verifyWalletSignature(
  pubkeyB58: string,
  messageUtf8: string,
  signatureB64: string,
): Promise<boolean> {
  let pubRaw: Uint8Array;
  try {
    pubRaw = bs58.decode(pubkeyB58);
  } catch {
    return false;
  }
  if (pubRaw.length !== 32) return false;
  let sig: Uint8Array;
  try {
    sig = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  const msg = new TextEncoder().encode(messageUtf8);
  try {
    const key = await crypto.subtle.importKey("raw", pubRaw, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sig, msg);
  } catch {
    return false;
  }
}

/**
 * GET/POST/DELETE `/v1/me/linked-wallet` (also registered under `/api/v1/me/linked-wallet` in router).
 * Bearer session; associates browser wallet pubkey with portal account.
 */
async function handleSolanaLinkedWalletRouteImpl(
  request: Request,
  env: AuthEnv,
  method: string,
): Promise<Response> {
  if (method !== "GET" && method !== "POST" && method !== "DELETE") {
    return json({ detail: "Method not allowed" }, 405);
  }

  const sess = await sessionFromRequest(env, request);
  if (!sess) {
    return json({ detail: extractAuthToken(request) ? "Unauthorized" : "Missing token" }, 401);
  }

  if (method === "GET") {
    const row = await env.DB.prepare(
      "SELECT pubkey, verified_at FROM solana_linked_wallets WHERE account_id = ?",
    )
      .bind(sess.accountId)
      .first<{ pubkey: string; verified_at: string }>();
    if (!row?.pubkey) {
      return json({ linked_wallet_pubkey: null, linked_wallet_verified_at: null }, 200);
    }
    return json({ linked_wallet_pubkey: row.pubkey, linked_wallet_verified_at: row.verified_at }, 200);
  }

  if (method === "DELETE") {
    await env.DB.prepare("DELETE FROM solana_linked_wallets WHERE account_id = ?").bind(sess.accountId).run();
    return json({ ok: true }, 200);
  }

  let body: { pubkey?: string; message?: string; signature?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }
  const pubkey = String(body.pubkey || "").trim();
  const message = String(body.message || "");
  const signature = String(body.signature || "").trim();
  if (!pubkey || !message || !signature) {
    return json({ detail: "pubkey, message, and signature are required." }, 422);
  }

  const parsed = parseSolanaLinkWalletMessage(message);
  if (!parsed) {
    return json({ detail: "Invalid message format." }, 422);
  }
  if (parsed.accountId !== sess.accountId) {
    return json({ detail: "Message does not match this account." }, 403);
  }
  if (parsed.wallet !== pubkey) {
    return json({ detail: "Message wallet does not match pubkey." }, 422);
  }
  const issued = Date.parse(parsed.issuedIso);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > 15 * 60 * 1000) {
    return json({ detail: "Message expired or invalid issued time. Refresh and try again." }, 422);
  }

  const okSig = await verifyWalletSignature(pubkey, message, signature);
  if (!okSig) {
    return json({ detail: "Signature verification failed." }, 401);
  }

  const taken = await env.DB.prepare(
    "SELECT account_id FROM solana_linked_wallets WHERE pubkey = ? AND account_id != ?",
  )
    .bind(pubkey, sess.accountId)
    .first<{ account_id: string }>();
  if (taken?.account_id) {
    return json({ detail: "That wallet is already linked to another RootRecord account." }, 409);
  }

  const now = new Date().toISOString();
  const preview = message.length > 200 ? message.slice(0, 200) : message;
  try {
    await env.DB.prepare(
      `INSERT INTO solana_linked_wallets (account_id, pubkey, verified_at, message_preview)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         pubkey = excluded.pubkey,
         verified_at = excluded.verified_at,
         message_preview = excluded.message_preview`,
    )
      .bind(sess.accountId, pubkey, now, preview)
      .run();
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("link wallet save", msg);
    if (/no such table|SQLITE_ERROR.*solana_linked_wallets/i.test(msg)) {
      return json(
        {
          detail:
            "Linked wallet storage is not deployed on this API yet. Apply D1 migration 0026 on root-record, then redeploy rootrecord-primary.",
        },
        503,
      );
    }
    return json({ detail: "Could not save link." }, 500);
  }

  return json({ ok: true, linked_wallet_pubkey: pubkey, linked_wallet_verified_at: now }, 200);
}

export async function handleSolanaLinkedWalletRoute(request: Request, env: AuthEnv, method: string): Promise<Response> {
  try {
    return await handleSolanaLinkedWalletRouteImpl(request, env, method);
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("solana-linked-wallet unhandled", msg);
    if (/no such table|SQLITE_ERROR.*solana_linked_wallets/i.test(msg)) {
      return json(
        {
          detail:
            "Linked wallet storage is not ready (D1 migration 0026). Apply migrations on root-record, then redeploy.",
        },
        503,
      );
    }
    return json({ detail: "Could not process wallet link. Try again in a moment." }, 500);
  }
}
