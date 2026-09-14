import { json } from "./cors";
import { extractAuthToken, sessionFromRequest, type AuthEnv } from "./primary-auth";
import { notifySolanaToolsDiscord } from "./discord-solana-notify";

const MAX_ACTION_LEN = 96;
const MAX_SUMMARY = 500;
const MAX_SIG_LEN = 128;
const MAX_CLUSTER = 32;
const MAX_META_JSON = 14_000;

function validAction(s: string): boolean {
  if (s.length < 2 || s.length > MAX_ACTION_LEN) return false;
  return /^[a-z][a-z0-9_.:-]*$/i.test(s);
}

function looksLikeSolanaPubkey(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

function truncateJson(obj: Record<string, unknown>, max: number): string {
  try {
    const s = JSON.stringify(obj, null, 0);
    return s.length <= max ? s : s.slice(0, max) + "…";
  } catch {
    return "{}";
  }
}

function appActivityMarkdown(
  sess: { accountId: string },
  body: {
    action: string;
    wallet?: string;
    signature?: string;
    summary?: string;
    cluster?: string;
    metadata?: Record<string, unknown>;
  }
): string {
  const metaStr =
    body.metadata && Object.keys(body.metadata).length > 0
      ? `\n**Metadata:**\n\`\`\`json\n${truncateJson(body.metadata, 1600)}\n\`\`\``
      : "";
  return (
    `**Token manager app** — \`${body.action}\`\n` +
    `**RootRecord account:** \`${sess.accountId}\`\n` +
    `**Wallet:** ${body.wallet ? `\`${body.wallet}\`` : "—"}\n` +
    `**Cluster:** ${body.cluster || "—"}\n` +
    `**Summary:** ${body.summary || "—"}\n` +
    `**Signature:** ${body.signature || "—"}${metaStr}`
  );
}

/**
 * POST /api/solana/activity — Bearer JWT (same as other mobile API routes).
 * Reports on-chain / tool actions from the token-manager app to Discord.
 */
export async function handleSolanaAppActivityRoute(
  request: Request,
  env: AuthEnv & { DISCORD_WEBHOOK_SOLANA_TOOLS?: string },
  sub: string,
  method: string
): Promise<Response | null> {
  if (sub !== "/solana/activity" || method !== "POST") return null;

  const sess = await sessionFromRequest(env, request);
  if (!sess) {
    return json(
      { detail: extractAuthToken(request) ? "Invalid or expired session." : "Sign in required." },
      401,
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ detail: "Invalid JSON." }, 400);
  }

  const b = raw as Record<string, unknown>;
  const action = String(b.action || "").trim().slice(0, MAX_ACTION_LEN);
  const walletRaw = b.wallet != null ? String(b.wallet).trim() : "";
  const wallet = walletRaw && looksLikeSolanaPubkey(walletRaw) ? walletRaw : undefined;
  if (walletRaw && !wallet) {
    return json({ detail: "Invalid wallet public key." }, 400);
  }
  const signature =
    b.signature != null ? String(b.signature).trim().slice(0, MAX_SIG_LEN) || undefined : undefined;
  const summary = b.summary != null ? String(b.summary).trim().slice(0, MAX_SUMMARY) || undefined : undefined;
  const cluster = b.cluster != null ? String(b.cluster).trim().slice(0, MAX_CLUSTER) || undefined : undefined;
  let metadata: Record<string, unknown> | undefined;
  if (b.metadata != null && typeof b.metadata === "object" && !Array.isArray(b.metadata)) {
    metadata = b.metadata as Record<string, unknown>;
  }

  if (!validAction(action)) {
    return json({ detail: "Invalid action name." }, 400);
  }
  if (metadata) {
    try {
      if (JSON.stringify(metadata).length > MAX_META_JSON) {
        return json({ detail: "metadata too large." }, 400);
      }
    } catch {
      return json({ detail: "Invalid metadata." }, 400);
    }
  }

  const md = appActivityMarkdown(sess, { action, wallet, signature, summary, cluster, metadata });
  await notifySolanaToolsDiscord(env.DISCORD_WEBHOOK_SOLANA_TOOLS, md);

  return json({ ok: true }, 201);
}
