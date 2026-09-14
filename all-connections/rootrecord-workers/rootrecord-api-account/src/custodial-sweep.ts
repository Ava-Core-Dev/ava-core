import type { D1Database } from "@cloudflare/workers-types";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";

import { json } from "./cors";
import { verifyWorkerOpsAdmin } from "./push";
import { TREASURY_WALLET_PUBKEY } from "./treasury-account";
import type { InternalWalletEnv } from "./solana-internal-wallet";
import { loadKeypairForAccount } from "./solana-internal-wallet";

export type SweepEnv = InternalWalletEnv & {
  SOLANA_RPC_URL?: string;
  RRTT_TREASURY_SECRET_KEY_B58?: string;
};

export type CustodialSweepResult = {
  /** If true, DELETE /v1/me and inactive purge must not remove DB rows. */
  blocksDeletion: boolean;
  /** Human-safe reason when blocksDeletion (503 body). */
  userMessage: string;
  /** Short log line for ops. */
  summary: string;
  signatures: string[];
  emptyVerified?: boolean;
};

type SweepOptions = {
  dryRun?: boolean;
  drainNativeSol?: boolean;
};

export type CustodialSweepPreview = {
  account_id: string;
  pubkey: string;
  sol_lamports: string;
  token_accounts: number;
  token_raw_total_counted_accounts: number;
  empty: boolean;
  error?: string;
};

function sweepRpcCandidates(env: SweepEnv): string[] {
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

async function custodialPubkey(db: D1Database, accountId: string): Promise<PublicKey | null> {
  const row = await db
    .prepare("SELECT pubkey FROM internal_solana_wallets WHERE account_id = ?")
    .bind(accountId)
    .first<{ pubkey: string }>();
  const p = String(row?.pubkey || "").trim();
  if (!p) return null;
  try {
    return new PublicKey(p);
  } catch {
    return null;
  }
}

async function hasMeaningfulOnChainBalance(connection: Connection, owner: PublicKey): Promise<boolean> {
  const lamports = await connection.getBalance(owner, "confirmed");
  const min = await connection.getMinimumBalanceForRentExemption(0);
  if (lamports > min + 25_000) return true;
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const r = await connection.getParsedTokenAccountsByOwner(owner, { programId });
    if ((r.value || []).length > 0) return true;
  }
  return false;
}

async function verifyCustodialEmpty(connection: Connection, owner: PublicKey, strictSol = false): Promise<boolean> {
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const r = await connection.getParsedTokenAccountsByOwner(owner, { programId });
    if ((r.value || []).length > 0) return false;
  }
  const lamports = await connection.getBalance(owner, "confirmed");
  if (strictSol) return lamports <= 0;
  const min = await connection.getMinimumBalanceForRentExemption(0);
  return lamports <= min + 75_000;
}

type ParsedTok = {
  pubkey: PublicKey;
  mint: PublicKey;
  amount: bigint;
  decimals: number;
  tokenProgram: PublicKey;
};

function collectParsedTokenAccounts(
  owner: PublicKey,
  programId: PublicKey,
  value: Awaited<ReturnType<Connection["getParsedTokenAccountsByOwner"]>>["value"],
): ParsedTok[] {
  const out: ParsedTok[] = [];
  for (const row of value || []) {
    const raw = row.account.data;
    if (typeof raw !== "object" || raw === null || !("parsed" in raw)) continue;
    const parsed = (raw as { parsed?: { type?: string; info?: Record<string, unknown> } }).parsed;
    if (!parsed || parsed.type !== "account" || !parsed.info) continue;
    const info = parsed.info as {
      mint?: string;
      owner?: string;
      tokenAmount?: { amount?: string; decimals?: number };
    };
    const mintStr = String(info.mint || "").trim();
    const ownerStr = String(info.owner || "").trim();
    if (!mintStr || !ownerStr) continue;
    let mint: PublicKey;
    let tokOwner: PublicKey;
    try {
      mint = new PublicKey(mintStr);
      tokOwner = new PublicKey(ownerStr);
    } catch {
      continue;
    }
    if (!tokOwner.equals(owner)) continue;
    const amount = BigInt(String(info.tokenAmount?.amount ?? "0"));
    const decimals = Math.min(9, Math.max(0, Math.floor(Number(info.tokenAmount?.decimals) || 0)));
    out.push({ pubkey: row.pubkey, mint, amount, decimals, tokenProgram: programId });
  }
  return out;
}

const SWEEP_COMPUTE_UNITS = 600_000;

async function sendSweepTx(
  connection: Connection,
  treasury: Keypair,
  custodial: Keypair,
  instructions: import("@solana/web3.js").TransactionInstruction[],
): Promise<string> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const budgetFirst = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: SWEEP_COMPUTE_UNITS }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
  ];
  const msg = new TransactionMessage({
    payerKey: treasury.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: [...budgetFirst, ...instructions],
  });
  const tx = new VersionedTransaction(msg.compileToV0Message());
  tx.sign([treasury, custodial]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 2 });
  await connection.confirmTransaction(
    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  return sig;
}

async function sendSelfPaidSolDrainTx(
  connection: Connection,
  custodial: Keypair,
  destination: PublicKey,
  balanceLamports: number,
): Promise<{ signature: string; lamportsSent: number } | null> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const feeProbeMessage = new TransactionMessage({
    payerKey: custodial.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: custodial.publicKey,
        toPubkey: destination,
        lamports: 0,
      }),
    ],
  }).compileToV0Message();
  const fee = (await connection.getFeeForMessage(feeProbeMessage, "confirmed")).value ?? 5_000;
  const send = balanceLamports - fee;
  if (send <= 0) return null;
  const msg = new TransactionMessage({
    payerKey: custodial.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: custodial.publicKey,
        toPubkey: destination,
        lamports: send,
      }),
    ],
  });
  const tx = new VersionedTransaction(msg.compileToV0Message());
  tx.sign([custodial]);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 2 });
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const status = await connection.getSignatureStatuses([signature]).catch(() => null);
    const s = status?.value?.[0];
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") break;
    if (s?.err) throw new Error(`transaction failed: ${JSON.stringify(s.err)}`);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  return { signature, lamportsSent: send };
}

/**
 * Transfers all SPL balances from custodial → treasury ATAs, closes custodial token accounts (rent to treasury),
 * then sends remaining SOL (minus rent-exempt minimum) to treasury. Treasury key pays fees.
 */
async function pickSweepConnection(env: SweepEnv): Promise<Connection | null> {
  for (const url of sweepRpcCandidates(env)) {
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

async function previewCustodialSweep(
  env: SweepEnv,
  connection: Connection,
  accountId: string,
  pubkeyRaw?: string,
): Promise<CustodialSweepPreview> {
  const pk = pubkeyRaw ? new PublicKey(pubkeyRaw) : await custodialPubkey(env.DB, accountId);
  if (!pk) {
    return { account_id: accountId, pubkey: "", sol_lamports: "0", token_accounts: 0, token_raw_total_counted_accounts: 0, empty: true };
  }
  try {
    const [lamports, classic, token2022] = await Promise.all([
      connection.getBalance(pk, "confirmed"),
      connection.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_PROGRAM_ID }),
      connection.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_2022_PROGRAM_ID }),
    ]);
    const tokenAccounts = [...collectParsedTokenAccounts(pk, TOKEN_PROGRAM_ID, classic.value), ...collectParsedTokenAccounts(pk, TOKEN_2022_PROGRAM_ID, token2022.value)];
    const tokenRawPositive = tokenAccounts.filter((t) => t.amount > 0n).length;
    return {
      account_id: accountId,
      pubkey: pk.toBase58(),
      sol_lamports: String(lamports),
      token_accounts: tokenAccounts.length,
      token_raw_total_counted_accounts: tokenRawPositive,
      empty: lamports <= 0 && tokenAccounts.length === 0,
    };
  } catch (e) {
    return {
      account_id: accountId,
      pubkey: pk.toBase58(),
      sol_lamports: "0",
      token_accounts: 0,
      token_raw_total_counted_accounts: 0,
      empty: false,
      error: String(e && typeof e === "object" && "message" in e ? (e as Error).message : e).slice(0, 200),
    };
  }
}

export async function sweepCustodialToTreasury(env: SweepEnv, accountId: string, opts: SweepOptions = {}): Promise<CustodialSweepResult> {
  const signatures: string[] = [];
  const treasurySkB58 = String(env.RRTT_TREASURY_SECRET_KEY_B58 || "").trim();
  const pk = await custodialPubkey(env.DB, accountId);
  if (!pk) {
    return {
      blocksDeletion: false,
      userMessage: "",
      summary: "no_custodial_wallet_row",
      signatures,
    };
  }

  /** Use first RPC that answers; empty-wallet detection must not trust a single blocked/failed host. */
  const connection = await pickSweepConnection(env);
  if (!connection) {
    return {
      blocksDeletion: true,
      userMessage:
        "Could not reach Solana to verify your custodial wallet. Account deletion was blocked for safety — try again later.",
      summary: "blocked_no_working_rpc",
      signatures,
    };
  }
  const hasAssets = opts.drainNativeSol
    ? !(await previewCustodialSweep(env, connection, accountId, pk.toBase58())).empty
    : await hasMeaningfulOnChainBalance(connection, pk);
  if (!hasAssets) {
    return {
      blocksDeletion: false,
      userMessage: "",
      summary: "nothing_on_chain",
      signatures,
      emptyVerified: true,
    };
  }

  if (opts.dryRun) {
    return {
      blocksDeletion: true,
      userMessage: "Dry run only.",
      summary: "dry_run_assets_present",
      signatures,
      emptyVerified: false,
    };
  }

  if (!treasurySkB58) {
    return {
      blocksDeletion: true,
      userMessage:
        "Your custodial wallet still holds on-chain assets, but treasury sweep is not configured. Contact support or try again later.",
      summary: "blocked_missing_treasury_secret",
      signatures,
    };
  }

  let treasury: Keypair;
  try {
    treasury = Keypair.fromSecretKey(bs58.decode(treasurySkB58));
  } catch {
    return {
      blocksDeletion: true,
      userMessage: "Treasury configuration error. Account deletion was blocked for safety.",
      summary: "blocked_bad_treasury_key",
      signatures,
    };
  }

  const custodial = await loadKeypairForAccount(env, accountId);
  if (!custodial || !custodial.publicKey.equals(pk)) {
    return {
      blocksDeletion: true,
      userMessage:
        "Could not unlock your custodial wallet to return funds. Account deletion was blocked for safety.",
      summary: "blocked_custodial_key_unavailable",
      signatures,
    };
  }

  const maxPasses = 12;
  for (let pass = 0; pass < maxPasses; pass++) {
    const batch: ParsedTok[] = [];
    for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const r = await connection.getParsedTokenAccountsByOwner(pk, { programId });
      batch.push(...collectParsedTokenAccounts(pk, programId, r.value));
    }
    if (batch.length === 0) break;

    for (const acc of batch) {
      const treasuryAta = getAssociatedTokenAddressSync(
        acc.mint,
        treasury.publicKey,
        false,
        acc.tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const ixs: import("@solana/web3.js").TransactionInstruction[] = [
        createAssociatedTokenAccountIdempotentInstruction(
          treasury.publicKey,
          treasuryAta,
          treasury.publicKey,
          acc.mint,
          acc.tokenProgram,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      ];
      if (acc.amount > 0n) {
        ixs.push(
          createTransferCheckedInstruction(
            acc.pubkey,
            acc.mint,
            treasuryAta,
            custodial.publicKey,
            acc.amount,
            acc.decimals,
            [],
            acc.tokenProgram,
          ),
        );
      }
      ixs.push(
        createCloseAccountInstruction(acc.pubkey, treasury.publicKey, custodial.publicKey, [], acc.tokenProgram),
      );
      try {
        const sig = await sendSweepTx(connection, treasury, custodial, ixs);
        signatures.push(sig);
      } catch (e) {
        const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
        return {
          blocksDeletion: true,
          userMessage:
            "Could not return all tokens to treasury (on-chain error). Nothing was deleted. Try again or contact support.",
          summary: `sweep_token_failed:${msg.slice(0, 200)}`,
          signatures,
        };
      }
    }
  }

  for (let i = 0; i < 4; i++) {
    const lamports = await connection.getBalance(custodial.publicKey, "confirmed");
    if (opts.drainNativeSol) {
      try {
        const drained = await sendSelfPaidSolDrainTx(connection, custodial, treasury.publicKey, lamports);
        if (!drained) break;
        signatures.push(drained.signature);
        continue;
      } catch (e) {
        const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
        return {
          blocksDeletion: true,
          userMessage:
            "Tokens were swept but some SOL could not be sent to treasury. Nothing was deleted. Contact support.",
          summary: `sweep_sol_failed:${msg.slice(0, 200)}`,
          signatures,
        };
      }
    }
    const minBal = opts.drainNativeSol ? 0 : await connection.getMinimumBalanceForRentExemption(0);
    const feePad = opts.drainNativeSol ? 0 : 12_000;
    const send = lamports - minBal - feePad;
    if (send <= 0) break;
    try {
      const sig = await sendSweepTx(connection, treasury, custodial, [
        SystemProgram.transfer({
          fromPubkey: custodial.publicKey,
          toPubkey: treasury.publicKey,
          lamports: send,
        }),
      ]);
      signatures.push(sig);
    } catch (e) {
      const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
      return {
        blocksDeletion: true,
        userMessage:
          "Tokens were swept but some SOL could not be sent to treasury. Nothing was deleted. Contact support.",
        summary: `sweep_sol_failed:${msg.slice(0, 200)}`,
        signatures,
      };
    }
  }

  const ok = await verifyCustodialEmpty(connection, pk, opts.drainNativeSol === true);
  if (!ok) {
    return {
      blocksDeletion: true,
      userMessage:
        "Post-sweep verification failed (wallet not empty). Nothing was deleted. Contact support with this message.",
      summary: "verify_failed_non_empty_wallet",
      signatures,
      emptyVerified: false,
    };
  }

  return {
    blocksDeletion: false,
    userMessage: "",
    summary: signatures.length ? `sweep_ok_${signatures.length}_tx` : "sweep_ok_no_tx_needed",
    signatures,
    emptyVerified: true,
  };
}

export async function handleSweepAllCustodialAssetsToTreasuryRoute(
  request: Request,
  env: SweepEnv & { RR_PUSH_ADMIN_SECRET?: string },
  sub: string,
  method: string,
): Promise<Response | null> {
  if (method !== "POST" || sub !== "/internal/sweep-all-custodial-assets-to-treasury") return null;
  if (!(await verifyWorkerOpsAdmin(request, env))) return json({ ok: false, detail: "Unauthorized." }, 401);

  let body: { dry_run?: boolean; confirm?: string; limit?: number; after_account_id?: string | null; account_id?: string | null } = {};
  try {
    body = (await request.json().catch(() => ({}))) as typeof body;
  } catch {
    body = {};
  }
  const dryRun = body.dry_run !== false;
  if (!dryRun && String(body.confirm || "") !== "SWEEP_ALL_CUSTODIAL_ASSETS_TO_TREASURY") {
    return json({ ok: false, detail: "Live sweep requires confirm = SWEEP_ALL_CUSTODIAL_ASSETS_TO_TREASURY." }, 400);
  }

  const connection = await pickSweepConnection(env);
  if (!connection) return json({ ok: false, detail: "No working Solana RPC from this Worker." }, 503);
  const treasuryPk = new PublicKey(TREASURY_WALLET_PUBKEY);
  const accountIdFilter = String(body.account_id || "").trim();
  const limit = Math.max(1, Math.min(50, Math.floor(Number(body.limit) || 10)));
  const after = String(body.after_account_id || "").trim();
  const rows = accountIdFilter
    ? await env.DB
        .prepare(
          `SELECT account_id, pubkey
           FROM internal_solana_wallets
           WHERE account_id = ?
           LIMIT 1`,
        )
        .bind(accountIdFilter)
        .all<{ account_id: string; pubkey: string }>()
    : await env.DB
        .prepare(
          `SELECT account_id, pubkey
           FROM internal_solana_wallets
           WHERE account_id > ?
           ORDER BY account_id ASC
           LIMIT ?`,
        )
        .bind(after, limit + 1)
        .all<{ account_id: string; pubkey: string }>();
  const rawList = rows.results || [];
  const list = accountIdFilter ? rawList : rawList.slice(0, limit);
  const nextCursor = !accountIdFilter && rawList.length > limit ? String(list[list.length - 1]?.account_id || "") : null;

  const results: Array<CustodialSweepPreview & { sweep?: string; signatures?: string[] }> = [];
  for (const row of list) {
    const accountId = String(row.account_id || "").trim();
    const pubkey = String(row.pubkey || "").trim();
    if (!accountId || !pubkey) continue;
    let owner: PublicKey;
    try {
      owner = new PublicKey(pubkey);
    } catch {
      results.push({ account_id: accountId, pubkey, sol_lamports: "0", token_accounts: 0, token_raw_total_counted_accounts: 0, empty: false, error: "invalid pubkey" });
      continue;
    }
    if (owner.equals(treasuryPk)) {
      results.push({ account_id: accountId, pubkey, sol_lamports: "0", token_accounts: 0, token_raw_total_counted_accounts: 0, empty: true, error: "skipped treasury wallet" });
      continue;
    }
    if (dryRun) {
      results.push(await previewCustodialSweep(env, connection, accountId, pubkey));
      continue;
    }
    const sweep = await sweepCustodialToTreasury(env, accountId, { drainNativeSol: true });
    const verify = await previewCustodialSweep(env, connection, accountId, pubkey);
    results.push({
      ...verify,
      ...(sweep.blocksDeletion || verify.empty !== true ? { error: sweep.summary || "post-sweep verification failed" } : {}),
      sweep: sweep.summary,
      signatures: sweep.signatures,
    });
  }

  return json({
    ok: true,
    dry_run: dryRun,
    destination: TREASURY_WALLET_PUBKEY,
    limit,
    next_after_account_id: nextCursor,
    processed: list.length,
    results,
    all_empty_in_batch: results.every((r) => r.empty === true || r.error === "skipped treasury wallet"),
  });
}
