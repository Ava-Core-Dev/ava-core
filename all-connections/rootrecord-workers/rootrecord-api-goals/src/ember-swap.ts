import type { D1Database } from "@cloudflare/workers-types";

import { creditPlayerShards } from "../../shared/ava-shards";
import {
  EMBER_LORE,
  EMBER_NAME,
  EMBER_TICKER,
  emberUsdPrice,
  pumpFunCoinUrl,
  shardsFromEmberUsd,
} from "../../shared/ava-embers";
import { json } from "./cors";
import { isServerGoalUser } from "./goal-constants";
import { issuePublicFields, resolveIssueCluster } from "./solana-cluster";
import {
  accountIdForUserId,
  provisionCustodialWalletIfMissing,
  readSplTokenBalance,
  transferSplToTreasury,
  type CustodialEnv,
} from "./member-custodial";

type EmberEnv = CustodialEnv & {
  DB: D1Database;
  AVA_EMBER_MINT_BASE58?: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function emberMint(env: EmberEnv): Promise<string | null> {
  const fromEnv = str(env.AVA_EMBER_MINT_BASE58);
  if (fromEnv) return fromEnv;
  try {
    const row = await env.DB.prepare("SELECT ember_mint_base58 FROM rg_ava_shard_meta WHERE id = 1")
      .first<{ ember_mint_base58: string | null }>();
    return str(row?.ember_mint_base58) || null;
  } catch {
    return null;
  }
}

export async function handlePublicEmbers(env: EmberEnv): Promise<Response> {
  const mint = await emberMint(env);
  const price = mint ? await emberUsdPrice(mint) : null;
  const issue = await issuePublicFields(env);
  const onDevnet = issue.solana_cluster === "devnet";
  return json({
    ok: true,
    name: EMBER_NAME,
    ticker: EMBER_TICKER,
    lore: EMBER_LORE,
    mint,
    pump_fun_url: mint ? pumpFunCoinUrl(mint) : null,
    usd_per_ember: price?.usd ?? null,
    price_source: price?.source ?? null,
    shards_per_ember: price ? shardsFromEmberUsd(price.usd) : null,
    peg_note: "Ava Shards stay 100 per $1 USDC. Embers convert at live USDC value.",
    swap_enabled: Boolean(mint) && !onDevnet,
    ...issue,
    ember_note: onDevnet
      ? "Ava Embers are a Pump.fun mainnet coin. Forge is paused while Goals is issuing on devnet (treasury below 0.01 SOL on mainnet, or testing pin)."
      : "Buy $EMBER on Pump.fun, send to your Root wallet, then forge into Ava Shards.",
  });
}

export async function handleEmbersMe(request: Request, env: EmberEnv, userId: string): Promise<Response> {
  if (request.method !== "GET") return json({ detail: "Method not allowed" }, 405);
  if (!userId.startsWith("user:")) return json({ detail: "Sign in required." }, 401);
  const mint = await emberMint(env);
  const accountId = await accountIdForUserId(env.DB, userId);
  if (!accountId) return json({ detail: "Account not found." }, 404);
  const wallet = await provisionCustodialWalletIfMissing(env, accountId);
  if ("error" in wallet) return json({ detail: wallet.error }, 503);
  const paused = (await resolveIssueCluster(env)) === "devnet";
  const bal = mint && !paused ? await readSplTokenBalance(env, wallet.pubkey, mint, "mainnet-beta") : { atomic: 0, decimals: 6, ui: 0 };
  const price = mint ? await emberUsdPrice(mint) : null;
  const usd = price ? bal.ui * price.usd : 0;
  return json({
    ok: true,
    mint,
    pubkey: wallet.pubkey,
    embers: bal.ui,
    embers_atomic: bal.atomic,
    usd_value: usd,
    shards_out: shardsFromEmberUsd(usd),
    usd_per_ember: price?.usd ?? null,
    pump_fun_url: mint ? pumpFunCoinUrl(mint) : null,
    swap_enabled: Boolean(mint) && !paused,
    ...(await issuePublicFields(env)),
  });
}

export async function handleEmbersSwap(request: Request, env: EmberEnv, userId: string): Promise<Response> {
  if (request.method !== "POST") return json({ detail: "Method not allowed" }, 405);
  if (!userId.startsWith("user:")) return json({ detail: "Sign in to swap Embers with Ava." }, 401);
  if ((await resolveIssueCluster(env)) === "devnet") {
    return json(
      {
        detail:
          "Ava Embers live on Pump.fun mainnet. Forge is paused while Goals is issuing on devnet — fund the treasury with 0.01 SOL on mainnet to issue there.",
        ...(await issuePublicFields(env)),
      },
      409,
    );
  }
  const mint = await emberMint(env);
  if (!mint) {
    return json({ detail: "Ava Embers are not launched on Pump.fun yet. Set the mint after the coin exists." }, 409);
  }
  const accountId = await accountIdForUserId(env.DB, userId);
  if (!accountId) return json({ detail: "Account not found." }, 404);
  const wallet = await provisionCustodialWalletIfMissing(env, accountId);
  if ("error" in wallet) return json({ detail: wallet.error }, 503);
  const body = record(await request.json().catch(() => ({})));
  const bal = await readSplTokenBalance(env, wallet.pubkey, mint);
  if (bal.atomic < 1) {
    return json(
      { detail: "No Ava Embers in your Root wallet. Buy on Pump.fun, then send them to the address on your profile." },
      400,
    );
  }
  let take = bal.atomic;
  if (body.amount != null && String(body.amount).trim() !== "") {
    const ui = Number(body.amount);
    if (!Number.isFinite(ui) || ui <= 0) return json({ detail: "amount must be a positive Ember count." }, 400);
    take = Math.min(bal.atomic, Math.floor(ui * 10 ** bal.decimals));
  }
  if (take < 1) return json({ detail: "Amount too small." }, 400);
  const uiTake = take / 10 ** bal.decimals;
  const price = await emberUsdPrice(mint);
  if (!price) return json({ detail: "Could not read a USDC price for Ava Embers right now." }, 503);
  const usd = uiTake * price.usd;
  const shards = shardsFromEmberUsd(usd);
  if (shards < 1) {
    return json({ detail: "That pile of Embers is worth less than 1 Ava Shard ($0.01) at the current USDC price." }, 400);
  }
  const sent = await transferSplToTreasury(env, accountId, mint, take);
  if (!sent.ok) return json({ detail: sent.message }, 400);
  const credited = await creditPlayerShards(env.DB, {
    accountId,
    shards,
    txRef: sent.signature,
    kind: "ember_swap",
    memo: `Forged ${uiTake} ${EMBER_TICKER} at $${price.usd.toPrecision(6)}`,
    minShards: 1,
  });
  if (!credited.ok) {
    return json(
      {
        detail: "Embers reached Ava but shards were not credited. Contact staff with the signature.",
        signature: sent.signature,
      },
      500,
    );
  }
  return json({
    ok: true,
    signature: sent.signature,
    embers_in: uiTake,
    usd_value: usd,
    price_usd: price.usd,
    price_source: price.source,
    shards_out: credited.player,
    ava_reserve: credited.ava,
  });
}

export async function handleEmbersConfig(request: Request, env: EmberEnv, userId: string): Promise<Response> {
  if (request.method !== "POST") return json({ detail: "Method not allowed" }, 405);
  if (!isServerGoalUser(userId)) return json({ detail: "Operator only." }, 403);
  const body = record(await request.json().catch(() => ({})));
  const mint = str(body.mint || body.ember_mint_base58);
  if (mint.length < 32) return json({ detail: "mint is required (Pump.fun coin address)." }, 400);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO rg_ava_shard_meta (id, mint_base58, ember_mint_base58, updated_at) VALUES (1, NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET ember_mint_base58 = excluded.ember_mint_base58, updated_at = excluded.updated_at`,
  )
    .bind(mint, now)
    .run();
  return json({ ok: true, mint, pump_fun_url: pumpFunCoinUrl(mint), name: EMBER_NAME, ticker: EMBER_TICKER });
}
