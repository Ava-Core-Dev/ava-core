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

async function verifyCustodialEmpty(connection: Connection, owner: PublicKey): Promise<boolean> {
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const r = await connection.getParsedTokenAccountsByOwner(owner, { programId });
    if ((r.value || []).length > 0) return false;
  }
  const lamports = await connection.getBalance(owner, "confirmed");
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

/**
 * Transfers all SPL balances from custodial → treasury ATAs, closes custodial token accounts (rent to treasury),
 * then sends remaining SOL (minus rent-exempt minimum) to treasury. Treasury key pays fees.
 */
export async function sweepCustodialToTreasury(env: SweepEnv, accountId: string): Promise<CustodialSweepResult> {
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
  let connection: Connection | null = null;
  let hasAssets = false;
  for (const url of sweepRpcCandidates(env)) {
    try {
      const c = new Connection(url, "confirmed");
      await c.getLatestBlockhash("confirmed");
      const h = await hasMeaningfulOnChainBalance(c, pk);
      connection = c;
      hasAssets = h;
      break;
    } catch {
      /* try next */
    }
  }
  if (!connection) {
    return {
      blocksDeletion: true,
      userMessage:
        "Could not reach Solana to verify your custodial wallet. Account deletion was blocked for safety — try again later.",
      summary: "blocked_no_working_rpc",
      signatures,
    };
  }
  if (!hasAssets) {
    return {
      blocksDeletion: false,
      userMessage: "",
      summary: "nothing_on_chain",
      signatures,
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

  const minBal = await connection.getMinimumBalanceForRentExemption(0);
  for (let i = 0; i < 4; i++) {
    const lamports = await connection.getBalance(custodial.publicKey, "confirmed");
    const feePad = 12_000;
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

  const ok = await verifyCustodialEmpty(connection, pk);
  if (!ok) {
    return {
      blocksDeletion: true,
      userMessage:
        "Post-sweep verification failed (wallet not empty). Nothing was deleted. Contact support with this message.",
      summary: "verify_failed_non_empty_wallet",
      signatures,
    };
  }

  return {
    blocksDeletion: false,
    userMessage: "",
    summary: signatures.length ? `sweep_ok_${signatures.length}_tx` : "sweep_ok_no_tx_needed",
    signatures,
  };
}
