import type { D1Database } from "@cloudflare/workers-types";
import { Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type Keypair } from "@solana/web3.js";

import { json } from "./cors";
import { sessionFromRequest, type AuthEnv } from "./primary-auth";
import { requireSensitiveAccountAction } from "./me-account-routes";
import { loadKeypairForAccount, type InternalWalletEnv } from "./solana-internal-wallet";
import { TREASURY_WALLET_PUBKEY } from "./treasury-account";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const ROOTS_MINT = "8hwxLN1Q4Yr8xFErErULCqNvcF1cMwGjpRXPz6DAH7gM";
const MIN_SWAP_LAMPORTS = 10_000;
const ROOTS_ATOMIC_PER_WHOLE = 100_000_000;
const ROOTS_PER_USD = 100 / 5; // $5 credit pack = 100 internal ROOTS.
const ROOTS_RATE_LABEL = "100 ROOTS per $5";
const ROOTS_RATE_DISCORD_LABEL = "100 ROOTS = $5";

export type RootsSolSwapRuntimeEnv = InternalWalletEnv & {
  DB: D1Database;
  SOLANA_RPC_URL?: string;
  HELIUS_RPC_URL?: string;
  NEXT_PUBLIC_RPC_URL?: string;
  DISCORD_ROOT_ECONOMY_WEBHOOK_URL?: string;
};

export type RootsSolSwapEnv = AuthEnv & RootsSolSwapRuntimeEnv;

export type RootsSolSwapQuoteResult = {
  input_mint: string;
  output_mint: string;
  input_lamports: number;
  requested_lamports: number;
  network_fee_lamports: number;
  slippage_bps: number;
  out_roots_raw: string;
  out_roots_atomic: number;
  price_impact_pct: string;
  route_plan_count: number;
  custodial_wallet: string;
  sol_balance_lamports: number;
  sol_usd_price: number;
  rate_label: string;
};

export type RootsSolSwapExecuteResult = {
  swap_id: string;
  tx_signature: string;
  explorer: string;
  input_lamports: number;
  requested_lamports: number;
  network_fee_lamports: number;
  execution_mode: "treasury_direct_internal";
  quoted_roots_raw: string;
  quoted_roots_atomic: number;
  sol_usd_price: number;
  internal_credit_status: "credited" | "pending";
  deposit_processor: unknown;
};

function rpcCandidates(env: RootsSolSwapRuntimeEnv): string[] {
  const primary = String(env.SOLANA_RPC_URL || "").trim();
  const helius = String(env.HELIUS_RPC_URL || "").trim();
  const nextPublic = String(env.NEXT_PUBLIC_RPC_URL || "").trim();
  const out: string[] = [];
  for (const url of [
    primary,
    helius,
    nextPublic,
    "https://solana-rpc.publicnode.com",
    "https://rpc.ankr.com/solana",
    "https://api.mainnet-beta.solana.com",
  ]) {
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

async function pickConnection(env: RootsSolSwapRuntimeEnv): Promise<Connection | null> {
  for (const url of rpcCandidates(env)) {
    try {
      const c = new Connection(url, "confirmed");
      await c.getLatestBlockhash("confirmed");
      return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function pickConnectionForWalletBalance(
  env: RootsSolSwapRuntimeEnv,
  wallet: PublicKey,
): Promise<{ connection: Connection; solBalance: number; rpcUrl: string } | null> {
  let best: { connection: Connection; solBalance: number; rpcUrl: string } | null = null;
  for (const url of rpcCandidates(env)) {
    try {
      const c = new Connection(url, "confirmed");
      await c.getLatestBlockhash("confirmed");
      const solBalance = await c.getBalance(wallet, "confirmed");
      if (!best || solBalance > best.solBalance) {
        best = { connection: c, solBalance, rpcUrl: url };
      }
    } catch {
      /* try next */
    }
  }
  return best;
}

function normalizeSwapInputLamports(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 1) return Math.floor(n * 1_000_000_000);
  return Math.floor(n);
}

export function clampRootsSolSwapSlippageBps(raw: unknown): number {
  return Math.max(10, Math.min(500, Math.floor(Number(raw) || 100)));
}

function rootsAtomicForSolUsd(lamports: number, solUsdPrice: number): number {
  const sol = Math.max(0, Math.floor(Number(lamports) || 0)) / 1_000_000_000;
  const usd = sol * Math.max(0, Number(solUsdPrice) || 0);
  return Math.max(0, Math.floor(usd * ROOTS_PER_USD * ROOTS_ATOMIC_PER_WHOLE));
}

function formatLamportsSol(lamports: number): string {
  return `${(Math.max(0, Math.floor(Number(lamports) || 0)) / 1_000_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 9,
  })} SOL`;
}

function isDiscordWebhookUrl(url: string): boolean {
  return /^https:\/\/discord(?:app)?\.com\/api\/webhooks\//i.test(url);
}

function formatRootsAtomic(atomic: number): string {
  const n = Math.max(0, Math.floor(Number(atomic) || 0));
  const whole = Math.floor(n / ROOTS_ATOMIC_PER_WHOLE);
  const frac = String(n % ROOTS_ATOMIC_PER_WHOLE).padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

async function postSwapDiscord(
  env: RootsSolSwapRuntimeEnv,
  input: {
    email: string;
    amountAtomic: number;
    inputLamports: number;
    txSignature: string;
    solUsdPrice: number;
  },
): Promise<void> {
  const webhook = String(env.DISCORD_ROOT_ECONOMY_WEBHOOK_URL || "").trim();
  if (!webhook || !isDiscordWebhookUrl(webhook)) return;
  const sol = (Math.max(0, input.inputLamports) / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 9 });
  const body = [
    "**Internal ROOTS swap**",
    `User: ${input.email}`,
    `SOL to treasury: ${sol} SOL`,
    `Internal credit: ${formatRootsAtomic(input.amountAtomic)} ROOTS`,
    `Rate: ${ROOTS_RATE_DISCORD_LABEL}`,
    ...(input.solUsdPrice > 0 ? [`SOL/USD: $${input.solUsdPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`] : []),
    `Tx: https://solscan.io/tx/${input.txSignature}`,
  ].join("\n");
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: body }),
  }).catch(() => {});
}

async function fetchSolUsdPrice(): Promise<number> {
  const jupUrl = `https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(SOL_MINT)}`;
  try {
    const res = await fetch(jupUrl, { headers: { Accept: "application/json", "User-Agent": "RootRecord/internal-sol-swap" } });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const keyed = data[SOL_MINT] as Record<string, unknown> | undefined;
    const nested = (data.data as Record<string, unknown> | undefined)?.[SOL_MINT] as Record<string, unknown> | undefined;
    const price = Number(keyed?.usdPrice ?? keyed?.price ?? nested?.usdPrice ?? nested?.price);
    if (Number.isFinite(price) && price > 0) return price;
  } catch {
    /* fallback below */
  }

  const cgUrl = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
  const res = await fetch(cgUrl, { headers: { Accept: "application/json", "User-Agent": "RootRecord/internal-sol-swap" } });
  const data = (await res.json().catch(() => ({}))) as { solana?: { usd?: unknown } };
  const price = Number(data.solana?.usd);
  if (Number.isFinite(price) && price > 0) return price;
  throw new Error("Could not load live SOL/USD price for internal swap.");
}

async function prepareSwapAccount(env: RootsSolSwapRuntimeEnv, accountId: string) {
  const custodial = await loadKeypairForAccount(env, accountId);
  if (!custodial) throw new Error("No custodial wallet on file or cannot decrypt key.");

  const picked = await pickConnectionForWalletBalance(env, custodial.publicKey);
  if (!picked) throw new Error("Could not reach Solana RPC. Try again later.");
  return { custodial, connection: picked.connection, solBalance: picked.solBalance, rpcUrl: picked.rpcUrl };
}

async function waitForSignatureQuick(connection: Connection, signature: string, maxWaitMs = 12_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const res = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true }).catch(() => null);
    const st = res?.value?.[0];
    if (st?.err) throw new Error(`on-chain failure: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return true;
    if (typeof st?.confirmations === "number" && st.confirmations > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

async function estimateSelfPaidSolTransferFee(
  connection: Connection,
  from: PublicKey,
  to: PublicKey,
): Promise<{ latest: Readonly<{ blockhash: string; lastValidBlockHeight: number }>; feeLamports: number }> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const feeProbeMessage = new TransactionMessage({
    payerKey: from,
    recentBlockhash: latest.blockhash,
    instructions: [SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: 0 })],
  }).compileToV0Message();
  const rawFeeLamports = (await connection.getFeeForMessage(feeProbeMessage, "confirmed")).value ?? 5_000;
  // A native SOL transfer should only need the signature fee. Clamp odd public-RPC estimates so
  // `/swap all` drains the spendable remainder instead of treating small balances as unaffordable.
  const feeLamports = Math.max(5_000, Math.min(Math.floor(Number(rawFeeLamports) || 5_000), 10_000));
  return { latest, feeLamports };
}

function spendableLamports(requestedLamports: number, solBalance: number, feeLamports: number): number {
  return Math.min(Math.max(0, Math.floor(requestedLamports)), Math.max(0, Math.floor(solBalance - feeLamports)));
}

async function sendSolToTreasury(
  connection: Connection,
  custodial: Keypair,
  lamports: number,
  solBalance: number,
  fee: { latest: Readonly<{ blockhash: string; lastValidBlockHeight: number }>; feeLamports: number },
  minLamports = MIN_SWAP_LAMPORTS,
): Promise<string> {
  const treasury = new PublicKey(TREASURY_WALLET_PUBKEY);
  const sendLamports = Math.max(0, Math.floor(lamports));
  if (sendLamports < minLamports) {
    throw new Error(
      `Not enough SOL to transfer after fee. Balance ${formatLamportsSol(solBalance)}, estimated fee ${formatLamportsSol(fee.feeLamports)}, spendable ${formatLamportsSol(sendLamports)}.`,
    );
  }
  if (sendLamports + fee.feeLamports > solBalance) {
    throw new Error("Not enough SOL to transfer the internal swap amount to treasury after network fee.");
  }
  const msg = new TransactionMessage({
    payerKey: custodial.publicKey,
    recentBlockhash: fee.latest.blockhash,
    instructions: [SystemProgram.transfer({ fromPubkey: custodial.publicKey, toPubkey: treasury, lamports: sendLamports })],
  });
  const tx = new VersionedTransaction(msg.compileToV0Message());
  tx.sign([custodial]);
  return connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
}

async function creditInternalRoots(input: {
  env: RootsSolSwapRuntimeEnv;
  swapId: string;
  accountId: string;
  email: string;
  amountAtomic: number;
  inputLamports: number;
  requestedLamports: number;
  txSignature: string;
  feeLamports: number;
  solUsdPrice: number;
}): Promise<void> {
  const amountAtomic = Math.max(0, Math.floor(Number(input.amountAtomic) || 0));
  if (amountAtomic <= 0) throw new Error("Internal swap produced no ROOTS credit.");
  const nowIso = new Date().toISOString();
  const userId = `user:${input.email.trim().toLowerCase()}`;
  await input.env.DB.batch([
    input.env.DB
      .prepare(
        `INSERT INTO rr_earn_balance (user_id, balance, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at`,
      )
      .bind(userId, amountAtomic, nowIso),
    input.env.DB
      .prepare(
        `INSERT INTO rr_earn_custodial_ledger (
           id, account_id, kind, direction, units, tx_signature, recipient_pubkey,
           app_snapshot_json, earn_balance_snapshot, notes, created_at
         ) VALUES (?, ?, 'sol_to_internal_roots_fixed_rate', 'in', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.accountId,
        amountAtomic,
        input.txSignature,
        TREASURY_WALLET_PUBKEY,
        JSON.stringify({
          source: "sol_swap_internal_fixed_rate",
          email: input.email.trim().toLowerCase(),
          requested_lamports: input.requestedLamports,
          input_lamports: input.inputLamports,
          network_fee_lamports: input.feeLamports,
          sol_usd_price: input.solUsdPrice,
          rate: ROOTS_RATE_LABEL,
        }),
        0,
        "SOL moved directly to treasury and internal ROOTS credited at fixed $5 = 100 ROOTS rate.",
        nowIso,
      ),
    input.env.DB
      .prepare("UPDATE rr_roots_sol_swaps SET status = 'treasury_direct_credited_internal', deposit_credited = 1, updated_at = ? WHERE id = ?")
      .bind(nowIso, input.swapId),
  ]);
}

export async function quoteRootsSolSwapForAccount(
  env: RootsSolSwapRuntimeEnv,
  accountId: string,
  requestedLamports: number,
  slippageBps = 100,
  opts: { all?: boolean } = {},
): Promise<RootsSolSwapQuoteResult> {
  if (!opts.all && requestedLamports < MIN_SWAP_LAMPORTS) throw new Error("Enter a SOL amount to swap.");
  const minLamports = opts.all ? 1 : MIN_SWAP_LAMPORTS;
  const prepared = await prepareSwapAccount(env, accountId);
  const fee = await estimateSelfPaidSolTransferFee(prepared.connection, prepared.custodial.publicKey, new PublicKey(TREASURY_WALLET_PUBKEY));
  const inputLamports = spendableLamports(opts.all ? Number.MAX_SAFE_INTEGER : requestedLamports, prepared.solBalance, fee.feeLamports);
  if (inputLamports < minLamports) {
    throw new Error(
      `Not enough SOL to move after fee. Balance ${formatLamportsSol(prepared.solBalance)}, estimated fee ${formatLamportsSol(fee.feeLamports)}, spendable ${formatLamportsSol(inputLamports)}.`,
    );
  }
  const solUsdPrice = await fetchSolUsdPrice();
  const outRootsAtomic = rootsAtomicForSolUsd(inputLamports, solUsdPrice);
  return {
    input_mint: SOL_MINT,
    output_mint: ROOTS_MINT,
    input_lamports: inputLamports,
    requested_lamports: opts.all ? inputLamports : requestedLamports,
    network_fee_lamports: fee.feeLamports,
    slippage_bps: clampRootsSolSwapSlippageBps(slippageBps),
    out_roots_raw: String(outRootsAtomic),
    out_roots_atomic: outRootsAtomic,
    price_impact_pct: "0",
    route_plan_count: 0,
    custodial_wallet: prepared.custodial.publicKey.toBase58(),
    sol_balance_lamports: prepared.solBalance,
    sol_usd_price: solUsdPrice,
    rate_label: ROOTS_RATE_LABEL,
  };
}

export async function executeRootsSolSwapForAccount(
  env: RootsSolSwapRuntimeEnv,
  accountId: string,
  email: string,
  requestedLamports: number,
  slippageBps = 100,
  opts: { all?: boolean } = {},
): Promise<RootsSolSwapExecuteResult> {
  if (!opts.all && requestedLamports < MIN_SWAP_LAMPORTS) throw new Error("Enter a SOL amount to swap.");
  const minLamports = opts.all ? 1 : MIN_SWAP_LAMPORTS;
  const prepared = await prepareSwapAccount(env, accountId);
  const fee = await estimateSelfPaidSolTransferFee(prepared.connection, prepared.custodial.publicKey, new PublicKey(TREASURY_WALLET_PUBKEY));
  const inputLamports = spendableLamports(opts.all ? Number.MAX_SAFE_INTEGER : requestedLamports, prepared.solBalance, fee.feeLamports);
  if (inputLamports < minLamports) {
    throw new Error(
      `Not enough SOL to move after fee. Balance ${formatLamportsSol(prepared.solBalance)}, estimated fee ${formatLamportsSol(fee.feeLamports)}, spendable ${formatLamportsSol(inputLamports)}.`,
    );
  }
  const solUsdPrice = await fetchSolUsdPrice();
  const quotedRootsAtomic = rootsAtomicForSolUsd(inputLamports, solUsdPrice);
  if (quotedRootsAtomic <= 0) throw new Error("Internal swap produced no ROOTS credit.");

  const swapId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO rr_roots_sol_swaps (
         id, account_id, user_id, custodial_wallet, input_lamports, quoted_roots_raw,
         quoted_roots_atomic, slippage_bps, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      swapId,
      accountId,
      `user:${email.trim().toLowerCase()}`,
      prepared.custodial.publicKey.toBase58(),
      String(inputLamports),
      String(quotedRootsAtomic),
      quotedRootsAtomic,
      clampRootsSolSwapSlippageBps(slippageBps),
      nowIso,
      nowIso,
    )
    .run();

  let signature = "";
  try {
    signature = await sendSolToTreasury(prepared.connection, prepared.custodial, inputLamports, prepared.solBalance, fee, minLamports);
    await env.DB
      .prepare("UPDATE rr_roots_sol_swaps SET status = 'treasury_direct_submitted', swap_signature = ?, updated_at = ? WHERE id = ?")
      .bind(signature, new Date().toISOString(), swapId)
      .run();
    const confirmed = await waitForSignatureQuick(prepared.connection, signature);
    if (!confirmed) {
      return {
        swap_id: swapId,
        tx_signature: signature,
        explorer: `https://solscan.io/tx/${signature}`,
        input_lamports: inputLamports,
        requested_lamports: opts.all ? inputLamports : requestedLamports,
        network_fee_lamports: fee.feeLamports,
        execution_mode: "treasury_direct_internal",
        quoted_roots_raw: String(quotedRootsAtomic),
        quoted_roots_atomic: quotedRootsAtomic,
        sol_usd_price: solUsdPrice,
        deposit_processor: { ok: true, mode: "pending_confirmation", deposits_credited: 0 },
        internal_credit_status: "pending",
      };
    }
    await creditInternalRoots({
      env,
      swapId,
      accountId,
      email,
      amountAtomic: quotedRootsAtomic,
      inputLamports,
      requestedLamports: opts.all ? inputLamports : requestedLamports,
      txSignature: signature,
      feeLamports: fee.feeLamports,
      solUsdPrice,
    });
    await postSwapDiscord(env, {
      email,
      amountAtomic: quotedRootsAtomic,
      inputLamports,
      txSignature: signature,
      solUsdPrice,
    });
  } catch (e) {
    const detail = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    if (signature) {
      await env.DB
        .prepare("UPDATE rr_roots_sol_swaps SET status = 'treasury_direct_submitted', error = ?, updated_at = ? WHERE id = ? AND deposit_credited = 0")
        .bind(`post-submit credit pending: ${detail}`.slice(0, 1000), new Date().toISOString(), swapId)
        .run()
        .catch(() => {});
      return {
        swap_id: swapId,
        tx_signature: signature,
        explorer: `https://solscan.io/tx/${signature}`,
        input_lamports: inputLamports,
        requested_lamports: opts.all ? inputLamports : requestedLamports,
        network_fee_lamports: fee.feeLamports,
        execution_mode: "treasury_direct_internal",
        quoted_roots_raw: String(quotedRootsAtomic),
        quoted_roots_atomic: quotedRootsAtomic,
        sol_usd_price: solUsdPrice,
        deposit_processor: { ok: true, mode: "pending_post_submit_credit", deposits_credited: 0, detail },
        internal_credit_status: "pending",
      };
    }
    await env.DB
      .prepare("UPDATE rr_roots_sol_swaps SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
      .bind(detail.slice(0, 1000), new Date().toISOString(), swapId)
      .run()
      .catch(() => {});
    throw new Error(`Internal swap failed: ${detail}${signature ? ` (${signature})` : ""}`);
  }

  return {
    swap_id: swapId,
    tx_signature: signature,
    explorer: `https://solscan.io/tx/${signature}`,
    input_lamports: inputLamports,
    requested_lamports: opts.all ? inputLamports : requestedLamports,
    network_fee_lamports: fee.feeLamports,
    execution_mode: "treasury_direct_internal",
    quoted_roots_raw: String(quotedRootsAtomic),
    quoted_roots_atomic: quotedRootsAtomic,
    sol_usd_price: solUsdPrice,
    deposit_processor: { ok: true, mode: "treasury_direct_internal_credit", deposits_credited: 1 },
    internal_credit_status: "credited",
  };
}

export async function runRootsSolSwapPendingCreditProcessor(
  env: RootsSolSwapRuntimeEnv,
  opts: { limit?: number } = {},
): Promise<{ ok: boolean; scanned: number; credited: number; pending: number; errors: Array<{ id: string; detail: string }> }> {
  const limit = Math.max(1, Math.min(20, Math.floor(Number(opts.limit) || 8)));
  const staleCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  await env.DB
    .prepare(
      `UPDATE rr_roots_sol_swaps
       SET status = 'failed',
           error = 'No on-chain signature recorded before request timeout; no SOL transfer was submitted by this swap row.',
           updated_at = ?
       WHERE status = 'pending'
         AND deposit_credited = 0
         AND swap_signature IS NULL
         AND created_at < ?`,
    )
    .bind(new Date().toISOString(), staleCutoff)
    .run()
    .catch(() => {});
  const rows = await env.DB
    .prepare(
      `SELECT s.id, s.account_id, lower(trim(la.email)) AS email, s.input_lamports, s.quoted_roots_atomic, s.swap_signature
       FROM rr_roots_sol_swaps s
       JOIN license_accounts la ON la.id = s.account_id
       WHERE s.deposit_credited = 0
         AND s.swap_signature IS NOT NULL
       ORDER BY s.created_at ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all<{
      id: string;
      account_id: string;
      email: string;
      input_lamports: string;
      quoted_roots_atomic: number;
      swap_signature: string;
    }>();

  const result = { ok: true, scanned: 0, credited: 0, pending: 0, errors: [] as Array<{ id: string; detail: string }> };
  const list = rows.results || [];
  if (!list.length) return result;
  const connection = await pickConnection(env);
  if (!connection) return { ...result, ok: false, errors: [{ id: "rpc", detail: "Could not reach Solana RPC." }] };

  for (const row of list) {
    result.scanned += 1;
    const id = String(row.id || "");
    const signature = String(row.swap_signature || "").trim();
    try {
      const st = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value?.[0];
      if (!st) {
        result.pending += 1;
        continue;
      }
      if (st.err) {
        await env.DB
          .prepare("UPDATE rr_roots_sol_swaps SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND deposit_credited = 0")
          .bind(`on-chain failure: ${JSON.stringify(st.err)}`.slice(0, 1000), new Date().toISOString(), id)
          .run();
        result.errors.push({ id, detail: "on-chain failure" });
        continue;
      }
      const confirmed =
        st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized" || (typeof st.confirmations === "number" && st.confirmations > 0);
      if (!confirmed) {
        result.pending += 1;
        continue;
      }
      const claim = await env.DB
        .prepare(
          "UPDATE rr_roots_sol_swaps SET status = 'treasury_direct_crediting', updated_at = ? WHERE id = ? AND swap_signature IS NOT NULL AND deposit_credited = 0",
        )
        .bind(new Date().toISOString(), id)
        .run();
      if ((claim.meta?.changes ?? 0) !== 1) continue;
      const amountAtomic = Math.max(0, Math.floor(Number(row.quoted_roots_atomic) || 0));
      const inputLamports = Math.max(0, Math.floor(Number(row.input_lamports) || 0));
      await creditInternalRoots({
        env,
        swapId: id,
        accountId: String(row.account_id || ""),
        email: String(row.email || ""),
        amountAtomic,
        inputLamports,
        requestedLamports: inputLamports,
        txSignature: signature,
        feeLamports: 0,
        solUsdPrice: 0,
      });
      await postSwapDiscord(env, {
        email: String(row.email || ""),
        amountAtomic,
        inputLamports,
        txSignature: signature,
        solUsdPrice: 0,
      });
      result.credited += 1;
    } catch (e) {
      result.errors.push({ id, detail: String(e instanceof Error ? e.message : e).slice(0, 300) });
    }
  }
  result.ok = result.errors.length === 0;
  return result;
}

export async function handleRootsSolSwapV1(
  request: Request,
  env: RootsSolSwapEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (sub !== "/v1/me/roots/swap-sol-quote" && sub !== "/v1/me/roots/swap-sol") return null;
  const sess = await sessionFromRequest(env, request);
  if (!sess) return json({ ok: false, detail: "Sign in required." }, 401);

  let body: { amount_sol?: number; amount_lamports?: number; slippage_bps?: number; all?: boolean } = {};
  try {
    body = method === "GET" ? {} : ((await request.json().catch(() => ({}))) as typeof body);
  } catch {
    body = {};
  }

  const url = new URL(request.url);
  const inputLamports =
    normalizeSwapInputLamports(body.amount_lamports ?? url.searchParams.get("amount_lamports")) ||
    normalizeSwapInputLamports(body.amount_sol ?? url.searchParams.get("amount_sol"));
  const useAll = body.all === true || url.searchParams.get("all") === "1" || url.searchParams.get("all") === "true";
  const slippageBps = clampRootsSolSwapSlippageBps(body.slippage_bps ?? url.searchParams.get("slippage_bps"));
  if (!useAll && inputLamports < MIN_SWAP_LAMPORTS) return json({ ok: false, detail: "Enter a SOL amount to swap." }, 400);

  if (sub === "/v1/me/roots/swap-sol-quote") {
    try {
      return json({ ok: true, ...(await quoteRootsSolSwapForAccount(env, sess.accountId, inputLamports, slippageBps, { all: useAll })) });
    } catch (e) {
      return json({ ok: false, detail: String(e instanceof Error ? e.message : e) }, 502);
    }
  }

  if (method !== "POST") return json({ ok: false, detail: "Method not allowed." }, 405);

  const gate = await requireSensitiveAccountAction(env.DB, sess.accountId);
  if (gate) return gate;

  try {
    return json({ ok: true, ...(await executeRootsSolSwapForAccount(env, sess.accountId, sess.email, inputLamports, slippageBps, { all: useAll })) });
  } catch (e) {
    return json({ ok: false, detail: String(e instanceof Error ? e.message : e) }, 502);
  }
}
