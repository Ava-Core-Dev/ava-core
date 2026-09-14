import type { D1Database } from "@cloudflare/workers-types";

import {
  AVA_SHARDS_PER_USD,
  governanceSnapshot,
  shardBalance,
  shardsFromUsdCents,
  transferShards,
} from "../../shared/ava-shards";
import { json } from "./cors";
import { emailFromUserId } from "./goal-constants";
import { accountIdForEmail, accountIdForUserId } from "./member-custodial";

type ShardEnv = {
  DB: D1Database;
  SITE_URL?: string;
  STRIPE_SECRET_KEY?: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function stripeOk(secret: string | undefined): boolean {
  const s = (secret || "").trim();
  return s.startsWith("sk_") && s.length > 30;
}

export async function handlePublicShardsGovernance(env: ShardEnv): Promise<Response> {
  try {
    const g = await governanceSnapshot(env.DB);
    return json({
      ok: true,
      name: "Ava Shards",
      lore: "Ava Shards replace vote shards. They are direct voting power. Ava always holds 42% of supply.",
      mint_pending: !g.mint_base58,
      ...g,
    });
  } catch (e) {
    return json({ detail: e instanceof Error ? e.message : "shards_unavailable" }, 503);
  }
}

export async function handleShardsMe(request: Request, env: ShardEnv, userId: string): Promise<Response> {
  if (!userId.startsWith("user:")) return json({ detail: "Sign in required." }, 401);
  const accountId = await accountIdForUserId(env.DB, userId);
  if (!accountId) return json({ detail: "Account not found." }, 404);
  const mine = await shardBalance(env.DB, accountId);
  const gov = await governanceSnapshot(env.DB).catch(() => null);
  return json({
    ok: true,
    shards: mine,
    usd: mine / AVA_SHARDS_PER_USD,
    vote_share_pct: gov && gov.total_shards > 0 ? Math.round((mine / gov.total_shards) * 10000) / 100 : 0,
    governance: gov,
  });
}

export async function handleShardsCheckout(request: Request, env: ShardEnv, userId: string): Promise<Response> {
  if (request.method !== "POST") return json({ detail: "Method not allowed" }, 405);
  if (!userId.startsWith("user:")) return json({ detail: "Sign in to buy Ava Shards." }, 401);
  const secret = (env.STRIPE_SECRET_KEY || "").trim();
  if (!stripeOk(secret)) return json({ detail: "Card checkout is not configured." }, 503);
  const accountId = await accountIdForUserId(env.DB, userId);
  if (!accountId) return json({ detail: "Account not found." }, 404);
  const body = record(await request.json().catch(() => ({})));
  const usd = Number(body.usd ?? body.amount_usd ?? 1);
  if (!Number.isFinite(usd) || usd < 1 || usd > 500) {
    return json({ detail: "Amount must be between $1 and $500." }, 400);
  }
  const cents = Math.round(usd * 100);
  const shards = shardsFromUsdCents(cents);
  const site = String(env.SITE_URL || "https://g.rootrecord.info").replace(/\/+$/, "");
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", `${site}/shards?bought=1`);
  params.set("cancel_url", `${site}/shards?canceled=1`);
  params.set("client_reference_id", accountId);
  params.set("customer_email", emailFromUserId(userId));
  params.set("metadata[kind]", "ava_shards");
  params.set("metadata[account_id]", accountId);
  params.set("metadata[shards]", String(shards));
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", String(cents));
  params.set("line_items[0][price_data][product_data][name]", `Ava Shards · ${shards.toLocaleString()}`);
  params.set(
    "line_items[0][price_data][product_data][description]",
    "100 Ava Shards per $1. Direct voting power. Credited to your Root Record wallet.",
  );
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const data = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok || !data.url) {
    return json({ detail: data.error?.message || "Could not start checkout." }, 400);
  }
  return json({ ok: true, url: data.url, shards, usd_cents: cents });
}

export async function handleShardsSend(request: Request, env: ShardEnv, userId: string): Promise<Response> {
  if (request.method !== "POST") return json({ detail: "Method not allowed" }, 405);
  if (!userId.startsWith("user:")) return json({ detail: "Sign in required." }, 401);
  const from = await accountIdForUserId(env.DB, userId);
  if (!from) return json({ detail: "Account not found." }, 404);
  const body = record(await request.json().catch(() => ({})));
  const amount = Math.floor(Number(body.amount || body.shards) || 0);
  const slug = str(body.slug);
  const email = str(body.email).toLowerCase();
  let to: string | null = null;
  if (email) to = await accountIdForEmail(env.DB, email);
  else if (slug) {
    const row = await env.DB.prepare("SELECT email FROM rg_profiles WHERE slug = ?")
      .bind(slug.toLowerCase())
      .first<{ email: string }>();
    if (row?.email) to = await accountIdForEmail(env.DB, row.email);
  }
  if (!to) return json({ detail: "Could not find that player." }, 404);
  const sent = await transferShards(env.DB, from, to, amount, "peer", `peer:${crypto.randomUUID()}`);
  if (!sent.ok) {
    const msg = sent.reason === "insufficient" ? "Not enough Ava Shards." : "Could not send shards.";
    return json({ detail: msg }, 400);
  }
  return json({ ok: true, shards: amount });
}
