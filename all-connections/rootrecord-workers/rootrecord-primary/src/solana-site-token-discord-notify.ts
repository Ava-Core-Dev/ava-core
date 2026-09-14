import { json } from "./cors";
import { isDiscordWebhookUrl } from "./discord-solana-notify";

export type SolanaSiteTokenDiscordEnv = {
  SOLANA_SITE_LOG_SECRET?: string;
  DISCORD_TOKEN_CREATE_WEBHOOK_URL?: string;
};

const MAX_NAME = 64;
const MAX_SYM = 16;
const MAX_URI = 512;
const MAX_SIG = 128;
const MAX_NET = 32;

/** Solana base58 public key (no @solana/web3 in Worker). */
function looksLikeSolanaPubkey(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

/** Transaction signatures are base58, typically 87–88 chars; allow a safe range. */
function looksLikeTxSignature(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,128}$/.test(s);
}

function validNetwork(n: string): boolean {
  return (
    n === "mainnet-beta" ||
    n === "devnet" ||
    n === "testnet" ||
    n === "localnet"
  );
}

function solscanTx(sig: string, network: string): string {
  const q =
    network === "mainnet-beta" || !network
      ? ""
      : `?cluster=${encodeURIComponent(network)}`;
  return `https://solscan.io/tx/${sig}${q}`;
}

function solscanToken(mint: string, network: string): string {
  const q =
    network === "mainnet-beta" || !network
      ? ""
      : `?cluster=${encodeURIComponent(network)}`;
  return `https://solscan.io/token/${mint}${q}`;
}

/**
 * POST /api/solana-site/token-discord-notify — Bearer `SOLANA_SITE_LOG_SECRET` (same as
 * `/api/solana-site/log`). Posts an embed to `DISCORD_TOKEN_CREATE_WEBHOOK_URL` when set.
 * Next.js proxies here when `SOLANA_SITE_LOG_URL` points at this Worker (same process as site log + tools forward).
 */
export async function handleSolanaSiteTokenDiscordNotifyRoute(
  request: Request,
  env: SolanaSiteTokenDiscordEnv,
  sub: string,
  method: string
): Promise<Response | null> {
  if (sub !== "/solana-site/token-discord-notify" || method !== "POST") {
    return null;
  }

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
  const mint = String(b.mint || "").trim();
  const creator = String(b.creator || "").trim();
  const signature = String(b.signature || "").trim().slice(0, MAX_SIG);
  const name = String(b.name || "").trim().slice(0, MAX_NAME);
  const symbol = String(b.symbol || "").trim().slice(0, MAX_SYM);
  const uri =
    b.uri != null ? String(b.uri).trim().slice(0, MAX_URI) : "";
  const network = String(b.network || "mainnet-beta")
    .trim()
    .slice(0, MAX_NET);
  const token2022 = Boolean(b.token2022);

  if (!mint || !creator || !signature || !name || !symbol) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }
  if (!validNetwork(network)) {
    return json({ ok: false, error: "invalid_network" }, 400);
  }
  if (!looksLikeSolanaPubkey(mint) || !looksLikeSolanaPubkey(creator)) {
    return json({ ok: false, error: "invalid_pubkey" }, 400);
  }
  if (!looksLikeTxSignature(signature)) {
    return json({ ok: false, error: "invalid_signature" }, 400);
  }

  const webhook = String(env.DISCORD_TOKEN_CREATE_WEBHOOK_URL || "").trim();
  if (!webhook || !isDiscordWebhookUrl(webhook)) {
    return json({ ok: true, skipped: true }, 202);
  }

  const programLabel = token2022 ? "Token-2022" : "SPL (legacy)";
  const descLines = [
    `**${symbol}** — ${name}`,
    "",
    `Mint: \`${mint}\``,
    `Creator: \`${creator}\``,
    `Program: ${programLabel}`,
    "",
    `[Solscan token](${solscanToken(mint, network)}) · [Create tx](${solscanTx(signature, network)})`,
  ];
  if (uri) {
    descLines.push(
      "",
      `Metadata URI: ${uri.length > 200 ? `${uri.slice(0, 200)}…` : uri}`
    );
  }

  const embed = {
    title: "New token created",
    description: descLines.join("\n").slice(0, 4000),
    color: 0xd946ef,
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json(
        {
          ok: false,
          error: "discord_upstream",
          status: res.status,
          detail: text.slice(0, 200),
        },
        502
      );
    }
    return json({ ok: true }, 201);
  } catch {
    return json({ ok: false, error: "discord_unreachable" }, 502);
  }
}
