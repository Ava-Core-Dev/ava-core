import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { notifySolanaToolsDiscord } from "./discord-solana-notify";

export type SolanaSiteLogEnv = {
  SOLANA_SITE_LOG_SECRET?: string;
  DISCORD_WEBHOOK_SOLANA_TOOLS?: string;
  DB: D1Database;
};

const MAX_ACTION_LEN = 96;
const MAX_ROUTE_LEN = 256;
const MAX_SIG_LEN = 128;
const MAX_META_JSON = 14_000;

function validAction(s: string): boolean {
  if (s.length < 2 || s.length > MAX_ACTION_LEN) return false;
  return /^[a-z][a-z0-9_.:-]*$/i.test(s);
}

/** Solana base58 public key (no @solana/web3 in Worker). */
function looksLikeSolanaPubkey(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

function siteLogMarkdown(body: {
  wallet: string;
  action: string;
  network?: string;
  route?: string;
  signature?: string;
  metadata?: Record<string, unknown>;
}): string {
  const metaStr =
    body.metadata && Object.keys(body.metadata).length > 0
      ? `\n**Metadata:**\n\`\`\`json\n${truncateJson(body.metadata, 1600)}\n\`\`\``
      : "";
  return (
    `**Solana site** — \`${body.action}\`\n` +
    `**Wallet:** \`${body.wallet}\`\n` +
    `**Network:** ${body.network || "—"}\n` +
    `**Route:** ${body.route || "—"}\n` +
    `**Signature:** ${body.signature || "—"}${metaStr}`
  );
}

function truncateJson(obj: Record<string, unknown>, max: number): string {
  try {
    const s = JSON.stringify(obj, null, 0);
    return s.length <= max ? s : s.slice(0, max) + "…";
  } catch {
    return "{}";
  }
}

const TOKEN_CREATE_ACTION = "token_create";

async function persistTokenCreateRow(
  db: D1Database,
  wallet: string,
  network: string | undefined,
  signature: string | undefined,
  metadata: Record<string, unknown> | undefined
): Promise<void> {
  if (!metadata) return;
  const mint = String(metadata.mint || "").trim();
  if (!looksLikeSolanaPubkey(mint)) return;

  const nameRaw = metadata.name != null ? String(metadata.name).trim() : "";
  const name = nameRaw ? nameRaw.slice(0, 256) : null;

  const symbolRaw = metadata.symbol != null ? String(metadata.symbol).trim() : "";
  const symbol = symbolRaw ? symbolRaw.slice(0, 64) : null;

  const token2022 = Boolean(metadata.token2022) ? 1 : 0;
  const net = network ? network.trim().slice(0, 32) : null;
  const sig = signature ? signature.trim().slice(0, MAX_SIG_LEN) : null;

  try {
    await db
      .prepare(
        `INSERT OR IGNORE INTO solana_site_token_create (wallet, mint, name, symbol, token2022, signature, network, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .bind(wallet, mint, name, symbol, token2022, sig, net)
      .run();
  } catch {
    /* table missing pre-migration or bind error — do not fail logging */
  }
}

/**
 * POST /api/solana-site/log — Bearer `SOLANA_SITE_LOG_SECRET` (same as Next `SOLANA_SITE_LOG_SECRET`).
 * Optional Discord fan-out via `DISCORD_WEBHOOK_SOLANA_TOOLS`.
 */
export async function handleSolanaSiteLogRoute(
  request: Request,
  env: SolanaSiteLogEnv,
  sub: string,
  method: string
): Promise<Response | null> {
  if (sub !== "/solana-site/log" || method !== "POST") return null;

  const expected = String(env.SOLANA_SITE_LOG_SECRET || "").trim();
  if (!expected) {
    return json({ ok: false, error: "solana_site_log_not_configured" }, 503);
  }

  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${expected}`) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const b = raw as Record<string, unknown>;
  const wallet = String(b.wallet || "").trim();
  const action = String(b.action || "").trim().slice(0, MAX_ACTION_LEN);
  const network =
    b.network != null ? String(b.network).trim().slice(0, 32) || undefined : undefined;
  const route =
    b.route != null ? String(b.route).trim().slice(0, MAX_ROUTE_LEN) || undefined : undefined;
  const signature =
    b.signature != null ? String(b.signature).trim().slice(0, MAX_SIG_LEN) || undefined : undefined;
  let metadata: Record<string, unknown> | undefined;
  if (b.metadata != null && typeof b.metadata === "object" && !Array.isArray(b.metadata)) {
    metadata = b.metadata as Record<string, unknown>;
  }

  if (!looksLikeSolanaPubkey(wallet)) {
    return json({ ok: false, error: "invalid_wallet" }, 400);
  }
  if (!validAction(action)) {
    return json({ ok: false, error: "invalid_action" }, 400);
  }
  if (metadata) {
    try {
      const s = JSON.stringify(metadata);
      if (s.length > MAX_META_JSON) {
        return json({ ok: false, error: "metadata_too_large" }, 400);
      }
    } catch {
      return json({ ok: false, error: "invalid_metadata" }, 400);
    }
  }

  const md = siteLogMarkdown({ wallet, action, network, route, signature, metadata });
  await notifySolanaToolsDiscord(env.DISCORD_WEBHOOK_SOLANA_TOOLS, md);

  if (action === TOKEN_CREATE_ACTION && metadata) {
    await persistTokenCreateRow(env.DB, wallet, network, signature, metadata);
  }

  return json({ ok: true }, 201);
}
