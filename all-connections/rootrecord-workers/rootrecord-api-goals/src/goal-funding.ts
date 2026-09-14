import type { D1Database, ExecutionContext, R2Bucket } from "@cloudflare/workers-types";
import { Keypair } from "@solana/web3.js";

import { json } from "./cors";
import { isServerGoalUser, SERVER_GOAL_EMAIL, symbolFromTitle } from "./goal-constants";
import { clusterForGoal, clusterPublicFields, resolveIssueCluster } from "./solana-cluster";
import { createGoalStripeDonateLink } from "./goal-stripe";
import { readCustodialBalances } from "./member-custodial";
import { getPublicPoster, posterEmailForRow, postersForRows } from "./profiles";
import { qrSvgForAddress } from "./qr-svg";

type FundingEnv = {
  DB: D1Database;
  SITE_URL?: string;
  GOAL_MEDIA?: R2Bucket;
  STRIPE_SECRET_KEY?: string;
  INTERNAL_WALLET_ENC_KEY_B64?: string;
  SOLANA_RPC_URL?: string;
  SOLANA_CLUSTER?: string;
  SOLANA_CLUSTER_OVERRIDE?: string;
  RRTT_TREASURY_SECRET_KEY_B58?: string;
  GOAL_TOKEN_RPC_URL?: string;
  GOAL_TOKEN_CLUSTER?: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

async function importAesKey(env: FundingEnv): Promise<CryptoKey | null> {
  const b64 = String(env.INTERNAL_WALLET_ENC_KEY_B64 || "").trim();
  if (!b64) return null;
  const raw = base64ToBytes(b64);
  if (raw.length !== 32) return null;
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptSecret(key: CryptoKey, plaintext: Uint8Array): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ctBuf)) };
}

async function decryptSecret(key: CryptoKey, ivB64: string, ctB64: string): Promise<Uint8Array> {
  const iv = base64ToBytes(ivB64);
  const ct = base64ToBytes(ctB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new Uint8Array(pt);
}

function publicTokenStatus(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  if (s === "minted" || s === "pending" || s === "awaiting_first_deposit") return s;
  const lower = s.toLowerCase();
  if (
    s === "failed:treasury_unfunded" ||
    lower.includes("prior credit") ||
    lower.includes("insufficient funds") ||
    lower.includes("attempt to debit") ||
    lower.includes("treasury_unfunded") ||
    lower.includes("seed_failed")
  ) {
    return "awaiting_treasury";
  }
  if (s.startsWith("failed:") || lower.includes("simulation failed")) return "mint_failed";
  if (s.startsWith("wallet_")) return "wallet_pending";
  return s.slice(0, 40);
}

const USDC_DECIMALS = 6;

async function liveWalletBalance(env: FundingEnv, pubkey: string, cluster?: string) {
  const pk = str(pubkey);
  if (!pk) {
    return {
      pubkey: null as string | null,
      sol: 0,
      sol_lamports: 0,
      usdc: 0,
      usdc_atomic: 0,
    };
  }
  const bal = await readCustodialBalances(env, pk, cluster);
  return {
    pubkey: pk,
    sol: bal.sol_lamports / 1e9,
    sol_lamports: bal.sol_lamports,
    usdc: bal.usdc_atomic / 10 ** USDC_DECIMALS,
    usdc_atomic: bal.usdc_atomic,
  };
}

export function fundingPublicFields(
  row: Record<string, unknown>,
  env: { SOLANA_CLUSTER?: string; SOLANA_CLUSTER_OVERRIDE?: string; GOAL_TOKEN_CLUSTER?: string } = {},
) {
  const id = str(row.id);
  return {
    image_url: row.image_url && id ? imagePublicUrl(row as FundingEnv, id) : row.image_url || null,
    token_mint: row.token_mint || null,
    token_symbol: row.token_symbol || null,
    token_name: row.token_name || null,
    token_status: publicTokenStatus(row.token_status),
    token_signature: row.token_signature || null,
    metadata_uri: id ? metadataUri(row as FundingEnv, id) : row.metadata_uri || null,
    donate_wallet: row.donate_wallet_pubkey || null,
    ...clusterPublicFields(env),
    stripe_payment_link: row.stripe_payment_link || null,
    is_server_goal: Boolean(row.is_server_goal),
    raised_cents: Number(row.raised_cents || 0) || 0,
    estimated_cost_cents: row.estimated_cost_cents == null ? null : Number(row.estimated_cost_cents),
    percent_complete: Math.max(0, Math.min(100, Math.floor(Number(row.percent_complete) || 0))),
    requires_money: Boolean(row.requires_money),
    target_date_est: row.target_date_est || null,
    funding_status: str(row.funding_status) || "open",
    tokens_minted: Math.max(0, Math.floor(Number(row.tokens_minted) || 0)),
    token_cluster: str(row.token_cluster) || clusterPublicFields(env).solana_cluster,
    share_tokens_for_full: 100,
  };
}

export function publicGoalPage(
  row: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  env: { SOLANA_CLUSTER?: string; SOLANA_CLUSTER_OVERRIDE?: string; GOAL_TOKEN_CLUSTER?: string } = {},
) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    purpose: row.purpose,
    owner_kind: Boolean(row.is_server_goal) ? "ava" : "community",
    target_date_est: row.target_date_est,
    ai_summary_text: row.ai_summary_text,
    updated_at: row.updated_at,
    created_at: row.created_at,
    page_path: `/goals/${row.id}`,
    ...fundingPublicFields(row, env),
    ...extra,
  };
}

function apiOrigin(env: FundingEnv): string {
  return "https://api-goals.rootrecord.info";
}

function metadataUri(env: FundingEnv, goalId: string): string {
  return `${apiOrigin(env)}/public/g/${goalId}/metadata.json`;
}

function imagePublicUrl(env: FundingEnv, goalId: string): string {
  return `${apiOrigin(env)}/public/g/${goalId}/image`;
}

export async function storeGoalImage(
  env: FundingEnv,
  goalId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const ct = contentType.startsWith("image/") ? contentType : "image/png";
  const now = new Date().toISOString();
  if (env.GOAL_MEDIA) {
    await env.GOAL_MEDIA.put(`goals/${goalId}/image`, bytes, { httpMetadata: { contentType: ct } });
  }
  await env.DB.prepare(
    `INSERT INTO rg_goal_blobs (goal_id, content_type, bytes, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(goal_id) DO UPDATE SET content_type = excluded.content_type, bytes = excluded.bytes, updated_at = excluded.updated_at`,
  )
    .bind(goalId, ct, bytes, now)
    .run();
  const url = imagePublicUrl(env, goalId);
  await env.DB.prepare(`UPDATE rg_goals SET image_url = ?, updated_at = ? WHERE id = ?`)
    .bind(url, now, goalId)
    .run();
  return url;
}

export async function readGoalImage(
  env: FundingEnv,
  goalId: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (env.GOAL_MEDIA) {
    const obj = await env.GOAL_MEDIA.get(`goals/${goalId}/image`);
    if (obj) {
      const buf = new Uint8Array(await obj.arrayBuffer());
      return { bytes: buf, contentType: obj.httpMetadata?.contentType || "image/png" };
    }
  }
  const row = await env.DB.prepare(`SELECT content_type, bytes FROM rg_goal_blobs WHERE goal_id = ?`)
    .bind(goalId)
    .first<{ content_type: string; bytes: unknown }>();
  if (!row) return null;
  let bytes: Uint8Array | null = null;
  if (row.bytes instanceof Uint8Array) bytes = row.bytes;
  else if (row.bytes instanceof ArrayBuffer) bytes = new Uint8Array(row.bytes);
  else if (typeof row.bytes === "string") bytes = base64ToBytes(row.bytes);
  if (!bytes?.byteLength) return null;
  return { bytes, contentType: row.content_type || "image/png" };
}

async function ensureDonateWallet(
  env: FundingEnv,
  row: Record<string, unknown>,
): Promise<{ pubkey: string; secret: Uint8Array } | { error: string }> {
  const existingPk = str(row.donate_wallet_pubkey);
  const enc = str(row.donate_wallet_enc);
  const iv = str(row.donate_wallet_iv);
  const key = await importAesKey(env);
  if (!key) return { error: "wallet_enc_key_missing" };

  if (existingPk && enc && iv) {
    try {
      const secret = await decryptSecret(key, iv, enc);
      return { pubkey: existingPk, secret };
    } catch {
      return { error: "wallet_decrypt_failed" };
    }
  }

  const kp = Keypair.generate();
  const sealed = await encryptSecret(key, kp.secretKey);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE rg_goals SET donate_wallet_pubkey = ?, donate_wallet_enc = ?, donate_wallet_iv = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(kp.publicKey.toBase58(), sealed.ct, sealed.iv, now, row.id)
    .run();
  return { pubkey: kp.publicKey.toBase58(), secret: kp.secretKey };
}

export async function loadGoalDonateKeypair(
  env: FundingEnv,
  goalId: string,
): Promise<{ pubkey: string; secret: Uint8Array } | { error: string }> {
  const row = await env.DB.prepare(
    `SELECT donate_wallet_pubkey, donate_wallet_enc, donate_wallet_iv FROM rg_goals WHERE id = ?`,
  )
    .bind(goalId)
    .first<Record<string, unknown>>();
  if (!row) return { error: "goal_missing" };
  return ensureDonateWallet(env, { ...row, id: goalId });
}

export async function provisionGoalFunding(
  env: FundingEnv,
  userId: string,
  goalId: string,
  ctx?: ExecutionContext,
): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare(`SELECT * FROM rg_goals WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
    .bind(goalId, userId)
    .first<Record<string, unknown>>();
  if (!row) throw new Error("Goal not found.");

  const now = new Date().toISOString();
  const server = isServerGoalUser(userId) ? 1 : 0;
  await env.DB.prepare(
    `UPDATE rg_goals SET public_enabled = 1, is_server_goal = ?, requires_money = 1, updated_at = ?, posted_by_email = CASE WHEN ? = 1 THEN ? ELSE posted_by_email END WHERE id = ?`,
  )
    .bind(server, now, server, SERVER_GOAL_EMAIL, goalId)
    .run();

  const wallet = await ensureDonateWallet(env, { ...row, is_server_goal: server });
  if ("error" in wallet) {
    await env.DB.prepare(`UPDATE rg_goals SET token_status = ?, updated_at = ? WHERE id = ?`)
      .bind(`wallet_${wallet.error}`, now, goalId)
      .run();
  }

  const imageUrl = imagePublicUrl(env, goalId);
  const site = String(env.SITE_URL || "https://g.rootrecord.info");

  if (!str(row.stripe_payment_link)) {
    const stripeArgs = {
      secretKey: env.STRIPE_SECRET_KEY,
      siteUrl: site,
      goalId,
      title: str(row.title),
      imageUrl,
    };
    let stripe = await createGoalStripeDonateLink(stripeArgs);
    if (!stripe.ok && imageUrl) {
      stripe = await createGoalStripeDonateLink({ ...stripeArgs, imageUrl: null });
    }
    if (stripe.ok) {
      await env.DB.prepare(
        `UPDATE rg_goals SET stripe_payment_link = ?, stripe_product_id = ?, stripe_price_id = ?, updated_at = ? WHERE id = ?`,
      )
        .bind(stripe.url, stripe.productId, stripe.priceId, now, goalId)
        .run();
    } else {
      console.error("stripe_goal_link_failed", stripe.message.slice(0, 200));
    }
  }

  const title = str(row.title) || "Goal";
  let symbol = str(row.token_symbol);
  if (!symbol) {
    try {
      const input = JSON.parse(str(row.user_input_json) || "{}") as Record<string, unknown>;
      symbol = str(input.token_symbol);
    } catch {
      symbol = "";
    }
  }
  symbol = (symbol || symbolFromTitle(title)).toUpperCase().slice(0, 8);
  const tokenName = str(row.token_name) || title.slice(0, 32);
  const uri = metadataUri(env, goalId);
  const awaiting = str(row.token_mint) ? str(row.token_status) || "minted" : "awaiting_first_deposit";
  await env.DB.prepare(
    `UPDATE rg_goals SET token_symbol = ?, token_name = ?, metadata_uri = ?, token_status = COALESCE(NULLIF(token_status,''), ?), updated_at = ? WHERE id = ?`,
  )
    .bind(symbol, tokenName, uri, awaiting, now, goalId)
    .run();

  const next = await env.DB.prepare(`SELECT * FROM rg_goals WHERE id = ?`).bind(goalId).first<Record<string, unknown>>();
  return next || row;
}

async function ensurePublicStripe(env: FundingEnv, row: Record<string, unknown>): Promise<void> {
  if (str(row.stripe_payment_link)) return;
  const goalId = str(row.id);
  if (!goalId) return;
  const stripeArgs = {
    secretKey: env.STRIPE_SECRET_KEY,
    siteUrl: String(env.SITE_URL || "https://g.rootrecord.info"),
    goalId,
    title: str(row.title),
    imageUrl: imagePublicUrl(env, goalId),
  };
  let stripe = await createGoalStripeDonateLink(stripeArgs);
  if (!stripe.ok) stripe = await createGoalStripeDonateLink({ ...stripeArgs, imageUrl: null });
  if (!stripe.ok) {
    console.error("stripe_goal_link_failed", stripe.message.slice(0, 200));
    return;
  }
  await env.DB.prepare(
    `UPDATE rg_goals SET stripe_payment_link = ?, stripe_product_id = ?, stripe_price_id = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(stripe.url, stripe.productId, stripe.priceId, new Date().toISOString(), goalId)
    .run();
}

export async function handlePublicGoalCatalog(
  env: FundingEnv,
  kind: "server" | "all" | "one",
  idOrSlug?: string,
  ctx?: ExecutionContext,
) {
  if (kind === "one" && idOrSlug) {
    let row =
      (await env.DB.prepare(
        `SELECT * FROM rg_goals WHERE id = ? AND deleted_at IS NULL AND public_enabled = 1`,
      )
        .bind(idOrSlug)
        .first<Record<string, unknown>>()) ||
      (await env.DB.prepare(
        `SELECT * FROM rg_goals WHERE slug = ? AND is_server_goal = 1 AND deleted_at IS NULL AND public_enabled = 1`,
      )
        .bind(idOrSlug)
        .first<Record<string, unknown>>());
    if (!row) return json({ detail: "Goal not found." }, 404);
    if (!str(row.stripe_payment_link)) {
      await ensurePublicStripe(env, row).catch((e) => console.error("stripe_self_heal", String(e).slice(0, 200)));
      const again = await env.DB.prepare(`SELECT * FROM rg_goals WHERE id = ?`)
        .bind(row.id)
        .first<Record<string, unknown>>();
      if (again) row = again;
    }
    const donations = await env.DB.prepare(
      `SELECT source, amount_cents, amount_atomic, currency, created_at, tx_ref FROM rg_goal_donations WHERE goal_id = ? ORDER BY created_at DESC LIMIT 25`,
    )
      .bind(row.id)
      .all();
    const cluster = await clusterForGoal(env, row);
    const live = await liveWalletBalance(env, str(row.donate_wallet_pubkey), cluster);
    return json({
      goal: publicGoalPage(row, {
        donations: donations.results ?? [],
        owner_email_public: Boolean(row.is_server_goal) ? SERVER_GOAL_EMAIL : null,
        posted_by: await getPublicPoster(env, posterEmailForRow(row)),
        live_balance: live,
        qr_url: live.pubkey ? `${apiOrigin(env)}/public/g/${row.id}/qr.svg` : null,
      }, { ...env, SOLANA_CLUSTER_OVERRIDE: cluster, SOLANA_CLUSTER: cluster, GOAL_TOKEN_CLUSTER: cluster }),
    });
  }

  const where =
    kind === "server"
      ? `(is_server_goal = 1 OR user_id = ?) AND deleted_at IS NULL AND public_enabled = 1`
      : `deleted_at IS NULL AND public_enabled = 1`;
  const binds = kind === "server" ? [`user:${SERVER_GOAL_EMAIL}`] : [];
  const rows = await env.DB.prepare(
    `SELECT id, slug, title, purpose, image_url, token_mint, token_symbol, token_status, donate_wallet_pubkey,
            stripe_payment_link, is_server_goal, raised_cents, estimated_cost_cents, percent_complete, requires_money,
            target_date_est, updated_at, created_at, user_id, posted_by_email, funding_status, tokens_minted, token_cluster
     FROM rg_goals WHERE ${where} ORDER BY is_server_goal DESC, updated_at DESC LIMIT 80`,
  )
    .bind(...binds)
    .all();
  const list = (rows.results ?? []) as Record<string, unknown>[];
  const posters = await postersForRows(env, list);
  const issue = await resolveIssueCluster(env);
  const goals = list.map((r) =>
    publicGoalPage(r, { posted_by: posters.get(posterEmailForRow(r)) || null }, {
      ...env,
      SOLANA_CLUSTER_OVERRIDE: String(r.token_cluster || issue),
      SOLANA_CLUSTER: String(r.token_cluster || issue),
      GOAL_TOKEN_CLUSTER: String(r.token_cluster || issue),
    }),
  );
  return json({
    goals,
    server_email: SERVER_GOAL_EMAIL,
    kind: kind === "server" ? "ava" : "public",
  });
}

export async function handleGoalImageGet(env: FundingEnv, goalId: string): Promise<Response> {
  const img = await readGoalImage(env, goalId);
  if (!img) return json({ detail: "No image." }, 404);
  return new Response(img.bytes, {
    headers: {
      "content-type": img.contentType,
      "cache-control": "public, max-age=86400",
    },
  });
}

export async function handleGoalMetadataGet(env: FundingEnv, goalId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT * FROM rg_goals WHERE id = ? AND deleted_at IS NULL AND public_enabled = 1`,
  )
    .bind(goalId)
    .first<Record<string, unknown>>();
  if (!row) return json({ detail: "Goal not found." }, 404);
  const image = imagePublicUrl(env, goalId);
  return json({
    name: str(row.token_name) || str(row.title),
    symbol: str(row.token_symbol) || symbolFromTitle(str(row.title)),
    description: str(row.purpose) || str(row.title),
    image,
    external_url: `${String(env.SITE_URL || "https://rootrecord.online").replace(/\/+$/, "")}/goals/${goalId}`,
    properties: {
      category: "image",
      files: [{ uri: image, type: "image/png" }],
    },
  });
}

export async function handleGoalQrGet(env: FundingEnv, goalId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT donate_wallet_pubkey FROM rg_goals WHERE id = ? AND deleted_at IS NULL AND public_enabled = 1`,
  )
    .bind(goalId)
    .first<{ donate_wallet_pubkey: string | null }>();
  const pk = str(row?.donate_wallet_pubkey);
  if (!pk) return json({ detail: "No donate address." }, 404);
  return new Response(qrSvgForAddress(pk), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}

export async function handleGoalBalanceGet(env: FundingEnv, goalId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT donate_wallet_pubkey, token_cluster FROM rg_goals WHERE id = ? AND deleted_at IS NULL AND public_enabled = 1`,
  )
    .bind(goalId)
    .first<Record<string, unknown>>();
  if (!row) return json({ detail: "Goal not found." }, 404);
  const cluster = await clusterForGoal(env, row);
  return json({ ok: true, live_balance: await liveWalletBalance(env, str(row.donate_wallet_pubkey), cluster), solana_cluster: cluster });
}

export function parseImagePayload(body: Record<string, unknown>): { bytes: Uint8Array; contentType: string } | null {
  const raw = str(body.image_base64) || str(body.image);
  if (!raw) return null;
  const m = raw.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  const b64 = m ? m[2] : raw.replace(/\s+/g, "");
  const contentType = m ? m[1] : str(body.image_content_type) || "image/png";
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(b64);
  } catch {
    return null;
  }
  if (bytes.byteLength < 32 || bytes.byteLength > 450_000) return null;
  if (!contentType.startsWith("image/")) return null;
  return { bytes, contentType };
}

