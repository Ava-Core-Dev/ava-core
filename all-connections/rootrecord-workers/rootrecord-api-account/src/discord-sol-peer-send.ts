import bs58 from "bs58";
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
  CUSTODIAL_SOL_RESERVE_LAMPORTS,
  CUSTODIAL_SOL_SIGN_FEE_BUFFER_LAMPORTS,
  custodialSolSpendWouldViolateReserve,
} from "./custodial-sol-reserve";
import { confirmSignedTxWithPoll, loadKeypairForAccount, type InternalWalletEnv } from "./solana-internal-wallet";

const SOL_PEER_CU = 120_000;

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
 * Native SOL from sender custodial → recipient custodial. Treasury pays tx fee; sender signs the transfer.
 */
export async function transferSolCustodialPeerViaTreasury(
  env: InternalWalletEnv,
  fromAccountId: string,
  toAccountId: string,
  lamports: number,
): Promise<{ ok: true; signature: string } | { ok: false; message: string }> {
  const treasurySkB58 = String(env.RRTT_TREASURY_SECRET_KEY_B58 || "").trim();
  if (!treasurySkB58) {
    return { ok: false, message: "Treasury fee payer is not configured — SOL sends are unavailable." };
  }

  const fromAid = String(fromAccountId || "").trim();
  const toAid = String(toAccountId || "").trim();
  if (!fromAid || !toAid || fromAid === toAid) {
    return { ok: false, message: "Invalid sender or recipient account." };
  }

  const sendLamports = Math.floor(Number(lamports) || 0);
  if (!Number.isFinite(sendLamports) || sendLamports < 1) {
    return { ok: false, message: "Amount must be at least **1** lamport." };
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
  if (fromPkStr !== fromCustodial.publicKey.toBase58()) {
    return { ok: false, message: "Wallet data mismatch for your account. Contact support." };
  }

  let treasury: Keypair;
  try {
    treasury = Keypair.fromSecretKey(bs58.decode(treasurySkB58));
  } catch {
    return { ok: false, message: "Server treasury key is misconfigured." };
  }

  const connection = await pickConnection(env);
  if (!connection) return { ok: false, message: "Could not reach Solana. Try again in a few minutes." };

  const toOwner = new PublicKey(toPkStr);
  const bal = await connection.getBalance(fromCustodial.publicKey, "confirmed").catch(() => -1);
  if (bal < 0) {
    return { ok: false, message: "Could not read your SOL balance. Try again in a minute." };
  }
  if (custodialSolSpendWouldViolateReserve(bal, BigInt(sendLamports))) {
    const minKeep = CUSTODIAL_SOL_RESERVE_LAMPORTS + CUSTODIAL_SOL_SIGN_FEE_BUFFER_LAMPORTS;
    const maxSend = Math.max(0, bal - minKeep);
    return {
      ok: false,
      message:
        `Not enough spendable SOL. You must keep **${(minKeep / 1e9).toFixed(6)}** SOL on your deposit wallet (reserve + fees). Max you can send now: **~${(maxSend / 1e9).toFixed(6)}** SOL (\`${maxSend.toLocaleString()}\` lamports).`,
    };
  }

  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: SOL_PEER_CU }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
    SystemProgram.transfer({
      fromPubkey: fromCustodial.publicKey,
      toPubkey: toOwner,
      lamports: sendLamports,
    }),
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
    console.error("discord_sol_peer_send", fromAid, toAid, m.slice(0, 300));
    return { ok: false, message: `On-chain send failed: ${m.slice(0, 200)}` };
  }

  return { ok: true, signature: sig };
}
