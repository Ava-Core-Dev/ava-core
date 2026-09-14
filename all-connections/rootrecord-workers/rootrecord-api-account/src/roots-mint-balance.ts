import type { D1Database } from "@cloudflare/workers-types";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";

import { json } from "./cors";
import { sessionFromRequest, type AuthEnv } from "./primary-auth";
import {
  confirmSignedTxWithPoll,
  loadKeypairForAccount,
  provisionCustodialWalletIfMissing,
  type InternalWalletEnv,
} from "./solana-internal-wallet";
import { readCustodialTokenSlots, syncCustodialTokenSlotsFromRpc } from "./custodial-wallet-token-slots";

const ROOTS_MINT_BASE58 = "8hwxLN1Q4Yr8xFErErULCqNvcF1cMwGjpRXPz6DAH7gM";
const ROOTS_DECIMALS = 8;
const MIN_CUSTODIAL_SOL_LAMPORTS = 10_000_000;
const ACTIVE_STATUSES = ["pending", "reserved", "submitted"];

const RPC_FALLBACKS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
];

export type RootsMintBalanceEnv = AuthEnv &
  InternalWalletEnv & {
    DB: D1Database;
    RR_PUSH_ADMIN_SECRET?: string;
    ROOTRECORD_SOLANA_TX_URL?: string;
    SOLANA_RPC_URL?: string;
    CUSTODIAL_RPC_REFRESH_BUDGET_MS?: string;
  };

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function rpcCandidates(env: RootsMintBalanceEnv): string[] {
  const primary = String(env.SOLANA_RPC_URL || "").trim();
  return Array.from(new Set([primary, ...RPC_FALLBACKS].filter(Boolean)));
}

async function pickConnection(env: RootsMintBalanceEnv): Promise<{ connection: Connection; rpcUrl: string } | null> {
  for (const rpcUrl of rpcCandidates(env)) {
    const connection = new Connection(rpcUrl, "confirmed");
    try {
      await connection.getLatestBlockhash("confirmed");
      return { connection, rpcUrl };
    } catch {
      /* try next */
    }
  }
  return null;
}

async function getEarnBalance(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT balance FROM rr_earn_balance WHERE user_id = ?")
    .bind(userId)
    .first<{ balance: number }>();
  return Math.max(0, Math.floor(Number(row?.balance) || 0));
}

function safeAtomicNumber(rawValue: string, decimals: number, targetDecimals: number): number {
  try {
    const raw = BigInt(String(rawValue || "0").split(".")[0] || "0");
    const sourceDecimals = Math.max(0, Math.floor(Number(decimals) || 0));
    let normalized = raw;
    if (sourceDecimals > targetDecimals) normalized = raw / 10n ** BigInt(sourceDecimals - targetDecimals);
    if (sourceDecimals < targetDecimals) normalized = raw * 10n ** BigInt(targetDecimals - sourceDecimals);
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    return Number(normalized > maxSafe ? maxSafe : normalized);
  } catch {
    return 0;
  }
}

async function markMintRequest(
  db: D1Database,
  id: string,
  status: string,
  detail?: string | null,
  txSignature?: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE rr_roots_mint_requests
       SET status = ?, error_detail = ?, tx_signature = COALESCE(?, tx_signature), updated_at = ?
       WHERE id = ?`,
    )
    .bind(status, detail ? detail.slice(0, 1000) : null, txSignature ?? null, now, id)
    .run();
}

async function refundReservedBalance(
  db: D1Database,
  id: string,
  userId: string,
  amount: number,
  detail: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare("UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?")
      .bind(amount, now, userId),
    db
      .prepare(
        `UPDATE rr_roots_mint_requests
         SET status = 'failed_refunded', error_detail = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(detail.slice(0, 1000), now, id),
  ]);
}

function parseDestination(raw: unknown, fallback: PublicKey): PublicKey | null {
  const s = String(raw ?? "").trim();
  if (!s) return fallback;
  try {
    return new PublicKey(s);
  } catch {
    return null;
  }
}

function solUi(lamports: number): string {
  return (Math.max(0, Math.floor(lamports)) / 1_000_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

async function readCustodialTreasuryBalances(
  env: RootsMintBalanceEnv,
  accountId: string,
): Promise<{ rootsAtomic: number; solLamports: number; rpcRefreshed: boolean }> {
  const budgetMs = Math.max(800, Math.min(8_000, Math.floor(Number(env.CUSTODIAL_RPC_REFRESH_BUDGET_MS) || 3_500)));
  const refresh = await syncCustodialTokenSlotsFromRpc(env, accountId, budgetMs).catch(() => ({ ok: false, slots_written: 0 }));
  const slots = await readCustodialTokenSlots(env.DB, accountId, 200).catch(() => []);
  const rootsSlot = slots.find((s) => String(s.mint_base58 || "").trim() === ROOTS_MINT_BASE58);
  const solSlot = slots.find((s) => String(s.mint_base58 || "").trim().toLowerCase() === "native");
  return {
    rootsAtomic: rootsSlot ? safeAtomicNumber(rootsSlot.amount_raw, rootsSlot.decimals, ROOTS_DECIMALS) : 0,
    solLamports: solSlot ? safeAtomicNumber(solSlot.amount_raw, solSlot.decimals, 9) : 0,
    rpcRefreshed: refresh.ok === true,
  };
}

async function readMintWalletBase(env: RootsMintBalanceEnv, accountId: string, email: string) {
  await provisionCustodialWalletIfMissing(env, accountId, { suppressDiscord: true });
  const custodial = await loadKeypairForAccount(env, accountId);
  if (!custodial) {
    return { ok: false as const, response: json({ ok: false, detail: "No custodial wallet on file or cannot decrypt key." }, 403) };
  }
  const userId = `user:${email.trim().toLowerCase()}`;
  const balance = await getEarnBalance(env.DB, userId);
  return { ok: true as const, custodial, userId, balance };
}

async function readMintWalletDisplayBase(env: RootsMintBalanceEnv, accountId: string, email: string) {
  await provisionCustodialWalletIfMissing(env, accountId, { suppressDiscord: true });
  const row = await env.DB
    .prepare("SELECT pubkey FROM internal_solana_wallets WHERE account_id = ?")
    .bind(accountId)
    .first<{ pubkey: string }>();
  const custodialWallet = String(row?.pubkey || "").trim();
  if (!custodialWallet) {
    return { ok: false as const, response: json({ ok: false, detail: "No custodial wallet on file." }, 404) };
  }
  const userId = `user:${email.trim().toLowerCase()}`;
  const balance = await getEarnBalance(env.DB, userId);
  return { ok: true as const, custodialWallet, userId, balance };
}

async function readMintStatus(env: RootsMintBalanceEnv, accountId: string, email: string) {
  const base = await readMintWalletBase(env, accountId, email);
  if (!base.ok) return base;
  const picked = await pickConnection(env);
  if (!picked) {
    return { ok: false as const, response: json({ ok: false, detail: "Could not reach Solana RPC. Try again later." }, 503) };
  }
  const lamports = await picked.connection.getBalance(base.custodial.publicKey, "confirmed");
  return {
    ok: true as const,
    connection: picked.connection,
    rpcUrl: picked.rpcUrl,
    custodial: base.custodial,
    userId: base.userId,
    balance: base.balance,
    lamports,
  };
}

export async function handleRootsMintBalanceV1(
  request: Request,
  env: RootsMintBalanceEnv,
  method: string,
): Promise<Response> {
  const sess = await sessionFromRequest(env, request);
  if (!sess) return json({ ok: false, detail: "Sign in required." }, 401);

  if (method === "GET") {
    const status = await readMintWalletDisplayBase(env, sess.accountId, sess.email);
    if (!status.ok) return status.response;
    const balances = await readCustodialTreasuryBalances(env, sess.accountId);
    return json({
      ok: true,
      roots_mint: ROOTS_MINT_BASE58,
      internal_balance_atomic: status.balance,
      custodial_roots_atomic: balances.rootsAtomic,
      custodial_wallet: status.custodialWallet,
      custodial_sol_lamports: balances.solLamports,
      minimum_sol_lamports: MIN_CUSTODIAL_SOL_LAMPORTS,
      can_mint: status.balance > 0 && balances.solLamports >= MIN_CUSTODIAL_SOL_LAMPORTS,
      rpc_refreshed: balances.rpcRefreshed,
    });
  }

  if (method !== "POST") return json({ ok: false, detail: "Method not allowed" }, 405);

  const status = await readMintStatus(env, sess.accountId, sess.email);
  if (!status.ok) return status.response;

  if (status.balance <= 0) return json({ ok: false, detail: "No internal ROOTS balance available to mint." }, 400);
  if (status.lamports < MIN_CUSTODIAL_SOL_LAMPORTS) {
    return json(
      {
        ok: false,
        detail: `Your custodial wallet needs at least 0.01 SOL to run the Minting Machine. Current balance: ${solUi(status.lamports)} SOL.`,
        custodial_wallet: status.custodial.publicKey.toBase58(),
        custodial_sol_lamports: status.lamports,
        minimum_sol_lamports: MIN_CUSTODIAL_SOL_LAMPORTS,
      },
      402,
    );
  }

  let body: { destination_pubkey?: string | null };
  try {
    body = (await request.json().catch(() => ({}))) as typeof body;
  } catch {
    return json({ ok: false, detail: "Invalid JSON" }, 400);
  }
  const destination = parseDestination(body.destination_pubkey, status.custodial.publicKey);
  if (!destination) return json({ ok: false, detail: "Invalid destination Solana wallet." }, 400);

  const active = await env.DB
    .prepare(
      `SELECT id, status FROM rr_roots_mint_requests
       WHERE account_id = ? AND status IN (${ACTIVE_STATUSES.map(() => "?").join(",")})
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(sess.accountId, ...ACTIVE_STATUSES)
    .first<{ id: string; status: string }>();
  if (active?.id) {
    return json({ ok: false, detail: "A ROOTS mint request is already in progress for this account.", request_id: active.id }, 409);
  }

  const base = String(env.ROOTRECORD_SOLANA_TX_URL || "").trim().replace(/\/+$/, "");
  const admin = String(env.RR_PUSH_ADMIN_SECRET || "").trim();
  if (!base || !admin) {
    return json({ ok: false, detail: "Minting Machine is not configured on this server." }, 503);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO rr_roots_mint_requests (
         id, account_id, user_id, amount_atomic, destination_owner, custodial_fee_payer, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      id,
      sess.accountId,
      status.userId,
      String(status.balance),
      destination.toBase58(),
      status.custodial.publicKey.toBase58(),
      now,
      now,
    )
    .run();

  const debit = await env.DB
    .prepare("UPDATE rr_earn_balance SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?")
    .bind(status.balance, now, status.userId, status.balance)
    .run();
  if ((debit.meta?.changes ?? 0) !== 1) {
    await markMintRequest(env.DB, id, "failed", "Insufficient internal ROOTS balance at reservation time.");
    return json({ ok: false, detail: "Insufficient internal ROOTS balance.", request_id: id }, 409);
  }
  await markMintRequest(env.DB, id, "reserved");

  let prepared: Record<string, unknown>;
  try {
    const res = await fetch(`${base}/api/internal/mint-roots`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RR-Push-Admin-Key": admin,
        "User-Agent": "RootRecord/roots-mint-balance",
      },
      body: JSON.stringify({
        request_id: id,
        amount_atomic: String(status.balance),
        destination_owner: destination.toBase58(),
        fee_payer_pubkey: status.custodial.publicKey.toBase58(),
      }),
    });
    prepared = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || !prepared.ok || !prepared.transaction_b64) {
      throw new Error(String(prepared.detail || `mint prepare failed (${res.status})`));
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await refundReservedBalance(env.DB, id, status.userId, status.balance, detail);
    return json({ ok: false, detail: `Mint transaction could not be prepared: ${detail}`, request_id: id }, 502);
  }

  let signature = "";
  try {
    const raw = base64ToBytes(String(prepared.transaction_b64 || ""));
    const tx = VersionedTransaction.deserialize(raw);
    tx.sign([status.custodial]);
    signature = await status.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await markMintRequest(env.DB, id, "submitted", null, signature);
    const latest = {
      blockhash: String(prepared.latest_blockhash || ""),
      lastValidBlockHeight: Math.floor(Number(prepared.last_valid_block_height) || 0),
    };
    await confirmSignedTxWithPoll(status.connection, signature, latest);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (signature && !/on-chain failure/i.test(detail)) {
      await markMintRequest(env.DB, id, "submitted", `Submitted but confirmation is unresolved: ${detail}`, signature);
      return json(
        {
          ok: false,
          pending: true,
          detail: "Mint transaction was submitted, but confirmation is still pending. Internal ROOTS remain reserved until support/automation reconciles it.",
          request_id: id,
          tx_signature: signature,
          explorer: `https://solscan.io/tx/${signature}`,
          new_balance: await getEarnBalance(env.DB, status.userId),
        },
        202,
      );
    }
    await refundReservedBalance(env.DB, id, status.userId, status.balance, detail);
    return json({ ok: false, detail: `Mint failed: ${detail}`, request_id: id }, 502);
  }

  const doneAt = new Date().toISOString();
  await env.DB
    .prepare(
      `UPDATE rr_roots_mint_requests
       SET status = 'confirmed', tx_signature = ?, error_detail = NULL, updated_at = ?, confirmed_at = ?
       WHERE id = ?`,
    )
    .bind(signature, doneAt, doneAt, id)
    .run();

  return json({
    ok: true,
    request_id: id,
    roots_mint: ROOTS_MINT_BASE58,
    amount_atomic: status.balance,
    destination_owner: destination.toBase58(),
    custodial_fee_payer: status.custodial.publicKey.toBase58(),
    tx_signature: signature,
    explorer: `https://solscan.io/tx/${signature}`,
    new_balance: await getEarnBalance(env.DB, status.userId),
  });
}
