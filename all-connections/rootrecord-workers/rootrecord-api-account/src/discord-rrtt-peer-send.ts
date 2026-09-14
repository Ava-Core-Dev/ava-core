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

import { confirmSignedTxWithPoll, loadKeypairForAccount, type InternalWalletEnv } from "./solana-internal-wallet";

const RRTT_PEER_CU = 600_000;

function rpcCandidates(env: Pick<InternalWalletEnv, "SOLANA_RPC_URL">): string[] {
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

async function pickConnection(env: Pick<InternalWalletEnv, "SOLANA_RPC_URL">): Promise<Connection | null> {
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

/**
 * Move whole RRTT units from sender's custodial ATA to recipient's custodial ATA.
 * Treasury pays fees and may create the recipient ATA (same pattern as custodial withdraw).
 */
export async function transferRrttCustodialPeerViaTreasury(
  env: InternalWalletEnv,
  fromAccountId: string,
  toAccountId: string,
  wholeUnits: number,
): Promise<{ ok: true; signature: string } | { ok: false; message: string }> {
  const mintStr = String(env.RRTT_MINT_BASE58 || "").trim();
  if (!mintStr) return { ok: false, message: "RRTT is not configured on this server." };
  const treasurySkB58 = String(env.RRTT_TREASURY_SECRET_KEY_B58 || "").trim();
  if (!treasurySkB58) {
    return { ok: false, message: "Treasury fee payer is not configured — RRTT sends are unavailable." };
  }

  const fromAid = String(fromAccountId || "").trim();
  const toAid = String(toAccountId || "").trim();
  if (!fromAid || !toAid || fromAid === toAid) {
    return { ok: false, message: "Invalid sender or recipient account." };
  }

  const fromRow = await env.DB
    .prepare("SELECT pubkey FROM internal_solana_wallets WHERE account_id = ?")
    .bind(fromAid)
    .first<{ pubkey: string }>();
  const toRow = await env.DB
    .prepare("SELECT pubkey FROM internal_solana_wallets WHERE account_id = ?")
    .bind(toAid)
    .first<{ pubkey: string }>();
  const fromPkStr = String(fromRow?.pubkey || "").trim();
  const toPkStr = String(toRow?.pubkey || "").trim();
  if (!fromPkStr || !toPkStr) {
    return {
      ok: false,
      message: "One of you does not have a deposit wallet yet — sign in at **https://rootrecord.cloud/account.html** once.",
    };
  }

  const fromCustodial = await loadKeypairForAccount(env, fromAid);
  if (!fromCustodial) {
    return { ok: false, message: "Could not unlock your wallet for signing. Try again later or use the website." };
  }

  let treasury: Keypair;
  try {
    treasury = Keypair.fromSecretKey(bs58.decode(treasurySkB58));
  } catch {
    return { ok: false, message: "Server treasury key is misconfigured." };
  }

  const connection = await pickConnection(env);
  if (!connection) return { ok: false, message: "Could not reach Solana. Try again in a few minutes." };

  const mint = new PublicKey(mintStr);
  const decimals = Math.min(9, Math.max(0, Math.floor(Number(String(env.RRTT_DECIMALS ?? "9").trim()) || 9) || 0));
  const toOwner = new PublicKey(toPkStr);
  if (fromPkStr !== fromCustodial.publicKey.toBase58()) {
    return { ok: false, message: "Wallet data mismatch for your account. Contact support." };
  }

  const fromAta = getAssociatedTokenAddressSync(mint, fromCustodial.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const toAta = getAssociatedTokenAddressSync(mint, toOwner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const tb = await connection.getTokenAccountBalance(fromAta, "confirmed").catch(() => null);
  if (!tb?.value?.amount) {
    return {
      ok: false,
      message: "No RRTT on your deposit wallet yet (or still loading). Check **/bal** after a minute.",
    };
  }
  const rawBal = BigInt(String(tb.value.amount));
  const div = decimals > 0 ? 10n ** BigInt(decimals) : 1n;
  const wantWhole = Math.floor(wholeUnits);
  if (!Number.isFinite(wantWhole) || wantWhole < 1) {
    return { ok: false, message: "Amount must be a whole number ≥ 1." };
  }
  const rawTransfer = decimals > 0 ? BigInt(wantWhole) * div : BigInt(wantWhole);
  if (rawTransfer <= 0n || rawTransfer > rawBal) {
    const maxWhole = Number(rawBal / div);
    return { ok: false, message: `Not enough RRTT. You have about **${maxWhole}** whole RRTT on-chain.` };
  }

  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: RRTT_PEER_CU }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
    createAssociatedTokenAccountIdempotentInstruction(
      treasury.publicKey,
      toAta,
      toOwner,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    createTransferCheckedInstruction(
      fromAta,
      mint,
      toAta,
      fromCustodial.publicKey,
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
  tx.sign([treasury, fromCustodial]);

  let sig: string;
  try {
    sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await confirmSignedTxWithPoll(connection, sig, latest);
  } catch (e) {
    const m = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("discord_rrtt_peer_send", fromAid, toAid, m.slice(0, 300));
    return { ok: false, message: `On-chain send failed: ${m.slice(0, 200)}` };
  }

  return { ok: true, signature: sig };
}
