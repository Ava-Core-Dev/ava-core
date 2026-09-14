import bs58 from "bs58";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { json } from "./cors";
import { insertWithdrawalToPersonalLedger } from "./earn-rewards-ledger";
import { extractAuthToken, sessionFromRequest } from "./primary-auth";
import { confirmSignedTxWithPoll, loadKeypairForAccount, type InternalWalletEnv } from "./solana-internal-wallet";

const WITHDRAW_COMPUTE_UNITS = 600_000;

function rpcCandidates(env: InternalWalletEnv): string[] {
  const primary = String(env.SOLANA_RPC_URL || "").trim();
  const fallbacks = [
    "https://solana-rpc.publicnode.com",
    "https://rpc.ankr.com/solana",
    "https://api.mainnet-beta.solana.com",
  ];
  const out: string[] = [];
  for (const u of [primary, ...fallbacks]) {
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

async function pickConnection(env: InternalWalletEnv): Promise<Connection | null> {
  for (const url of rpcCandidates(env)) {
    try {
      const c = new Connection(url, "confirmed");
      await c.getLatestBlockhash("confirmed");
      return c;
    } catch {
      /* next */
    }
  }
  return null;
}

async function resolveWithdrawDestination(
  db: D1Database,
  accountId: string,
  bodyDest: string | undefined,
): Promise<{ dest: string; source: "linked_wallet" | "saved_withdraw_dest" } | { error: string; status: number }> {
  const linked = await db
    .prepare("SELECT pubkey, verified_at FROM solana_linked_wallets WHERE account_id = ? LIMIT 1")
    .bind(accountId)
    .first<{ pubkey: string; verified_at: string | null }>();
  const linkedPub = String(linked?.pubkey || "").trim();
  const verifiedAt = String(linked?.verified_at || "").trim();
  const linkedOk = Boolean(linkedPub && verifiedAt);

  const cs = await db
    .prepare("SELECT withdraw_dest_pubkey FROM rr_earn_custodial_state WHERE account_id = ? LIMIT 1")
    .bind(accountId)
    .first<{ withdraw_dest_pubkey: string | null }>();
  const saved = String(cs?.withdraw_dest_pubkey || "").trim();

  const primary = linkedOk ? linkedPub : saved;
  if (!primary) {
    return {
      error:
        "Set a payout address under Withdraw RRTT, or link and verify a header wallet — nothing to send to yet.",
      status: 422,
    };
  }
  try {
    new PublicKey(primary);
  } catch {
    return { error: "Saved payout address is invalid. Update it and try again.", status: 422 };
  }

  if (bodyDest != null && String(bodyDest).trim()) {
    const b = String(bodyDest).trim();
    try {
      new PublicKey(b);
    } catch {
      return { error: "Invalid destination_pubkey in request body.", status: 422 };
    }
    if (b !== primary) {
      return {
        error: "destination_pubkey must match your verified linked wallet or saved payout address.",
        status: 422,
      };
    }
  }

  return { dest: primary, source: linkedOk ? "linked_wallet" : "saved_withdraw_dest" };
}

/**
 * POST `/v1/me/custodial-withdraw-rrtt` — Bearer.
 * Body: `{ amount_whole?: number }` (omit or 0 = all whole RRTT on custodial ATA). Treasury pays tx fee; custodial signs SPL out.
 */
export async function handleCustodialRrttWithdrawV1(
  request: Request,
  env: InternalWalletEnv,
  method: string,
): Promise<Response> {
  if (method !== "POST") return json({ detail: "Method not allowed" }, 405);
  const sess = await sessionFromRequest(env, request);
  if (!sess) {
    return json({ detail: extractAuthToken(request) ? "Unauthorized" : "Missing token" }, 401);
  }

  let body: { amount_whole?: number; destination_pubkey?: string | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }

  const mintStr = String(env.RRTT_MINT_BASE58 || "").trim();
  if (!mintStr) return json({ detail: "RRTT mint is not configured on this server.", ok: false }, 503);

  const treasurySkB58 = String(env.RRTT_TREASURY_SECRET_KEY_B58 || "").trim();
  if (!treasurySkB58) {
    return json(
      {
        detail: "Treasury fee payer is not configured; RRTT withdraw cannot run. Contact support.",
        ok: false,
      },
      503,
    );
  }

  const destRes = await resolveWithdrawDestination(env.DB, sess.accountId, body?.destination_pubkey ?? undefined);
  if ("error" in destRes) return json({ detail: destRes.error, ok: false }, destRes.status);

  const custodial = await loadKeypairForAccount(env, sess.accountId);
  if (!custodial) return json({ detail: "No custodial wallet on file or cannot decrypt key.", ok: false }, 403);

  let treasury: Keypair;
  try {
    treasury = Keypair.fromSecretKey(bs58.decode(treasurySkB58));
  } catch {
    return json({ detail: "Treasury configuration error.", ok: false }, 500);
  }

  const connection = await pickConnection(env);
  if (!connection) {
    return json({ detail: "Could not reach Solana RPC. Try again later.", ok: false }, 503);
  }

  const mint = new PublicKey(mintStr);
  const decimals = Math.min(9, Math.max(0, Math.floor(Number(String(env.RRTT_DECIMALS ?? "9").trim()) || 9) || 0));
  const destPk = new PublicKey(destRes.dest);
  if (destPk.equals(custodial.publicKey)) {
    return json({ detail: "Destination cannot be the custodial wallet itself.", ok: false }, 422);
  }

  const custodialAta = getAssociatedTokenAddressSync(
    mint,
    custodial.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const destAta = getAssociatedTokenAddressSync(mint, destPk, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const tb = await connection.getTokenAccountBalance(custodialAta, "confirmed").catch(() => null);
  if (!tb?.value?.amount) {
    return json({ detail: "No RRTT balance on custodial token account (or RPC could not read it).", ok: false }, 400);
  }
  const rawBal = BigInt(String(tb.value.amount));
  const div = decimals > 0 ? 10n ** BigInt(decimals) : 1n;
  const maxWhole = Number(rawBal / div);
  if (!Number.isFinite(maxWhole) || maxWhole < 1) {
    return json({ detail: "Nothing to withdraw (zero whole RRTT on custodial).", ok: false }, 400);
  }

  let wantWhole = Math.floor(Number(body?.amount_whole) || 0);
  if (!Number.isFinite(wantWhole) || wantWhole <= 0) wantWhole = maxWhole;
  wantWhole = Math.min(wantWhole, maxWhole);
  if (wantWhole < 1) {
    return json({ detail: "amount_whole must be at least 1.", ok: false }, 422);
  }

  const rawTransfer = decimals > 0 ? BigInt(wantWhole) * 10n ** BigInt(decimals) : BigInt(wantWhole);
  if (rawTransfer <= 0n || rawTransfer > rawBal) {
    return json({ detail: "Withdraw amount exceeds custodial balance.", ok: false }, 400);
  }

  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: WITHDRAW_COMPUTE_UNITS }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
    createAssociatedTokenAccountIdempotentInstruction(
      treasury.publicKey,
      destAta,
      destPk,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    createTransferCheckedInstruction(
      custodialAta,
      mint,
      destAta,
      custodial.publicKey,
      rawTransfer,
      decimals,
      [],
      TOKEN_PROGRAM_ID,
    ),
  ];

  const latest = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: treasury.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: ixs,
  });
  const tx = new VersionedTransaction(msg.compileToV0Message());
  tx.sign([treasury, custodial]);

  let sig: string;
  try {
    sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await confirmSignedTxWithPoll(connection, sig, latest);
  } catch (e) {
    const m = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("custodial withdraw rrtt", sess.accountId, m);
    return json({ detail: `Withdraw failed on-chain: ${m}`, ok: false }, 502);
  }

  const now = new Date().toISOString();
  try {
    await env.DB.prepare("INSERT OR IGNORE INTO rr_earn_custodial_state (account_id) VALUES (?)").bind(sess.accountId).run();
    const cur = await env.DB
      .prepare("SELECT IFNULL(units_withdrawn_from_custodial, 0) AS w FROM rr_earn_custodial_state WHERE account_id = ?")
      .bind(sess.accountId)
      .first<{ w: number }>();
    const prevW = Math.max(0, Math.floor(Number(cur?.w) || 0));
    const balAfter = await connection.getTokenAccountBalance(custodialAta, "confirmed").catch(() => null);
    let onchainWhole: number | null = null;
    if (balAfter?.value) {
      const ui = balAfter.value.uiAmount;
      if (ui != null && Number.isFinite(ui)) onchainWhole = Math.floor(ui);
      else if (balAfter.value.amount != null) {
        const r = Math.floor(Number(balAfter.value.amount) || 0);
        const d = decimals > 0 ? 10 ** decimals : 1;
        onchainWhole = Math.floor(r / d);
      }
    }
    const lamports = await connection.getBalance(custodial.publicKey, "confirmed").catch(() => 0);
    await env.DB
      .prepare(
        `UPDATE rr_earn_custodial_state SET units_withdrawn_from_custodial = ?, custodial_rrtt_onchain = ?, sol_balance_lamports_cached = ?, cache_updated_at = ? WHERE account_id = ?`,
      )
      .bind(prevW + wantWhole, onchainWhole, lamports, now, sess.accountId)
      .run();
    await insertWithdrawalToPersonalLedger(env.DB, {
      accountId: sess.accountId,
      units: wantWhole,
      txSignature: sig,
      recipientPubkey: destRes.dest,
      notes: `destination_source=${destRes.source}`,
    });
  } catch (e) {
    const m = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("custodial withdraw rrtt db", sess.accountId, m, sig);
    return json(
      {
        detail:
          "Transfer confirmed on-chain but updating the ledger failed. Contact support with this transaction signature.",
        ok: false,
        tx_signature: sig,
      },
      500,
    );
  }

  return json(
    {
      ok: true,
      tx_signature: sig,
      amount_whole: wantWhole,
      destination: destRes.dest,
      destination_source: destRes.source,
    },
    200,
  );
}
