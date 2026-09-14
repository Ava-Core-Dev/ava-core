/**
 * Hosted Solana wallets for Root Record members (same D1 table as account shard).
 * Goal posters get a 0.01 SOL seed from treasury so mint rent and fees are covered.
 */
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
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";

import { CHAIN_FEE_BPS, feeFromBps } from "../../shared/platform-fees";
import { json } from "./cors";
import { emailFromUserId } from "./goal-constants";
import { clusterPublicFields, clusterRpcCandidates, issuePublicFields, parseSolanaCluster, resolveIssueCluster, usdcMint, withCluster } from "./solana-cluster";

export const GOAL_POSTER_SOL_LAMPORTS = 10_000_000; // 0.01 SOL — same as treasury issue minimum
export const CUSTODIAL_SOL_RESERVE_LAMPORTS = 1_000_000; // 0.001 SOL stay-behind
export const MIN_MINT_PAYER_LAMPORTS = 8_000_000;
const USDC_DECIMALS = 6;
const TRANSFER_CU = 200_000;

export type CustodialEnv = {
  DB: D1Database;
  INTERNAL_WALLET_ENC_KEY_B64?: string;
  SOLANA_RPC_URL?: string;
  SOLANA_CLUSTER?: string;
  SOLANA_CLUSTER_OVERRIDE?: string;
  GOAL_TOKEN_CLUSTER?: string;
  GOAL_TOKEN_RPC_URL?: string;
  RRTT_TREASURY_SECRET_KEY_B58?: string;
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

function d1BlobToUint8(v: unknown): Uint8Array | null {
  if (v == null) return null;
  if (v instanceof Uint8Array) return v.byteLength ? v : null;
  if (v instanceof ArrayBuffer) {
    const u = new Uint8Array(v);
    return u.byteLength ? u : null;
  }
  if (Array.isArray(v)) {
    const u = new Uint8Array(v as number[]);
    return u.byteLength ? u : null;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try {
      const u = base64ToBytes(s);
      return u.byteLength ? u : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function importAesKey(env: CustodialEnv): Promise<CryptoKey | null> {
  const b64 = String(env.INTERNAL_WALLET_ENC_KEY_B64 || "").trim();
  if (!b64) return null;
  const raw = base64ToBytes(b64);
  if (raw.length !== 32) return null;
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function aesGcmEncrypt(key: CryptoKey, plaintext: Uint8Array): Promise<{ iv: Uint8Array; ct: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { iv, ct: new Uint8Array(ctBuf) };
}

async function aesGcmDecrypt(key: CryptoKey, iv: Uint8Array, ct: Uint8Array): Promise<Uint8Array> {
  const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new Uint8Array(ptBuf);
}

export async function accountIdForEmail(db: D1Database, emailRaw: string): Promise<string | null> {
  const email = str(emailRaw).toLowerCase();
  if (!email) return null;
  const la = await db
    .prepare("SELECT id FROM license_accounts WHERE email = ? LIMIT 1")
    .bind(email)
    .first<{ id: string }>();
  if (str(la?.id)) return str(la?.id);
  const ua = await db
    .prepare("SELECT account_id FROM user_accounts WHERE email = ? LIMIT 1")
    .bind(email)
    .first<{ account_id: string | null }>();
  return str(ua?.account_id) || null;
}

export async function accountIdForUserId(db: D1Database, userId: string): Promise<string | null> {
  return accountIdForEmail(db, emailFromUserId(userId));
}

async function readWalletRow(
  db: D1Database,
  accountId: string,
): Promise<{ pubkey: string; enc: Uint8Array; iv: Uint8Array } | null> {
  const row = await db
    .prepare(
      "SELECT pubkey, privkey_pkcs8_enc AS enc_raw, privkey_iv AS iv_raw FROM internal_solana_wallets WHERE account_id = ?",
    )
    .bind(accountId)
    .first<{ pubkey: string; enc_raw: unknown; iv_raw: unknown }>();
  if (!row?.pubkey) return null;
  const enc = d1BlobToUint8(row.enc_raw);
  const iv = d1BlobToUint8(row.iv_raw);
  if (!enc || !iv) return null;
  return { pubkey: str(row.pubkey), enc, iv };
}

export async function custodialPubkeyForEmail(db: D1Database, emailRaw: string): Promise<string | null> {
  const accountId = await accountIdForEmail(db, emailRaw);
  if (!accountId) return null;
  const row = await db
    .prepare("SELECT pubkey FROM internal_solana_wallets WHERE account_id = ?")
    .bind(accountId)
    .first<{ pubkey: string }>();
  return str(row?.pubkey) || null;
}

export async function loadKeypairForAccount(env: CustodialEnv, accountId: string): Promise<Keypair | null> {
  const row = await readWalletRow(env.DB, accountId);
  if (!row) return null;
  const aesKey = await importAesKey(env);
  if (!aesKey) return null;
  try {
    const sk = await aesGcmDecrypt(aesKey, row.iv, row.enc);
    if (sk.length === 64) return Keypair.fromSecretKey(sk);
    if (sk.length === 32) return Keypair.fromSeed(sk);
  } catch {
    return null;
  }
  return null;
}

export async function provisionCustodialWalletIfMissing(
  env: CustodialEnv,
  accountId: string,
): Promise<{ pubkey: string; created: boolean } | { error: string }> {
  const aid = str(accountId);
  if (!aid) return { error: "account_missing" };
  const existing = await readWalletRow(env.DB, aid);
  if (existing) return { pubkey: existing.pubkey, created: false };
  const aesKey = await importAesKey(env);
  if (!aesKey) return { error: "wallet_enc_key_missing" };
  const kp = Keypair.generate();
  const enc = await aesGcmEncrypt(aesKey, kp.secretKey);
  try {
    await env.DB.prepare(
      "INSERT INTO internal_solana_wallets (account_id, pubkey, privkey_pkcs8_enc, privkey_iv) VALUES (?, ?, ?, ?)",
    )
      .bind(aid, kp.publicKey.toBase58(), enc.ct, enc.iv)
      .run();
  } catch (e) {
    const again = await readWalletRow(env.DB, aid);
    if (again) return { pubkey: again.pubkey, created: false };
    return { error: e instanceof Error ? e.message : "wallet_insert_failed" };
  }
  return { pubkey: kp.publicKey.toBase58(), created: true };
}

function rpcCandidates(env: CustodialEnv): string[] {
  return clusterRpcCandidates(env);
}

export async function pickConnection(env: CustodialEnv, cluster?: string): Promise<Connection | null> {
  const resolved = parseSolanaCluster(cluster) || (await resolveIssueCluster(env));
  const scoped = withCluster(env, resolved);
  for (const url of rpcCandidates(scoped)) {
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

function treasuryPublicKey(env: CustodialEnv): PublicKey | null {
  const raw = str(env.RRTT_TREASURY_SECRET_KEY_B58);
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(raw)).publicKey;
  } catch {
    return null;
  }
}

function treasuryKeypair(env: CustodialEnv): Keypair | null {
  const raw = str(env.RRTT_TREASURY_SECRET_KEY_B58);
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(raw));
  } catch {
    return null;
  }
}

export async function seedCustodialToLamports(
  env: CustodialEnv,
  pubkeyB58: string,
  targetLamports: number,
  cluster?: string,
): Promise<{ ok: true; signature: string | null; lamports: number } | { ok: false; message: string }> {
  const conn = await pickConnection(env, cluster);
  if (!conn) return { ok: false, message: "rpc_unavailable" };
  let dest: PublicKey;
  try {
    dest = new PublicKey(pubkeyB58);
  } catch {
    return { ok: false, message: "bad_pubkey" };
  }
  const bal = await conn.getBalance(dest, "confirmed").catch(() => -1);
  if (bal < 0) return { ok: false, message: "balance_read_failed" };
  if (bal >= targetLamports) return { ok: true, signature: null, lamports: bal };
  const treasury = treasuryKeypair(env);
  if (!treasury) return { ok: false, message: "treasury_not_configured" };
  const need = targetLamports - bal;
  try {
    const latest = await conn.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({
      payerKey: treasury.publicKey,
      recentBlockhash: latest.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: TRANSFER_CU }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
        SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: dest, lamports: need }),
      ],
    });
    const tx = new VersionedTransaction(msg.compileToV0Message());
    tx.sign([treasury]);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await conn.confirmTransaction(
      { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed",
    );
    const next = await conn.getBalance(dest, "confirmed").catch(() => bal + need);
    return { ok: true, signature: sig, lamports: next };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, message: m.slice(0, 220) };
  }
}

export async function ensurePosterCustodial(
  env: CustodialEnv,
  userId: string,
): Promise<{
  pubkey: string;
  secret: Uint8Array | null;
  lamports: number;
  seeded: boolean;
  seed_error: string | null;
}> {
  const accountId = await accountIdForUserId(env.DB, userId);
  if (!accountId) {
    return { pubkey: "", secret: null, lamports: 0, seeded: false, seed_error: "account_missing" };
  }
  const provisioned = await provisionCustodialWalletIfMissing(env, accountId);
  if ("error" in provisioned) {
    return { pubkey: "", secret: null, lamports: 0, seeded: false, seed_error: provisioned.error };
  }
  const seed = await seedCustodialToLamports(env, provisioned.pubkey, GOAL_POSTER_SOL_LAMPORTS);
  const kp = await loadKeypairForAccount(env, accountId);
  let lamports = seed.ok ? seed.lamports : 0;
  if (!seed.ok) {
    const live = await readCustodialBalances(env, provisioned.pubkey);
    lamports = live.sol_lamports;
  }
  return {
    pubkey: provisioned.pubkey,
    secret: kp ? kp.secretKey : null,
    lamports,
    seeded: seed.ok && Boolean(seed.signature),
    seed_error: seed.ok ? null : seed.message,
  };
}

export async function readCustodialBalances(
  env: CustodialEnv,
  pubkeyB58: string,
  cluster?: string,
): Promise<{ sol_lamports: number; usdc_atomic: number }> {
  const empty = { sol_lamports: 0, usdc_atomic: 0 };
  const resolved = parseSolanaCluster(cluster) || (await resolveIssueCluster(env));
  const scoped = withCluster(env, resolved);
  const conn = await pickConnection(env, resolved);
  if (!conn) return empty;
  let owner: PublicKey;
  try {
    owner = new PublicKey(pubkeyB58);
  } catch {
    return empty;
  }
  const sol = await conn.getBalance(owner, "confirmed").catch(() => 0);
  let usdc = 0;
  try {
    const mint = new PublicKey(usdcMint(scoped));
    const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const info = await conn.getTokenAccountBalance(ata, "confirmed");
    usdc = Math.max(0, Math.floor(Number(info.value.amount) || 0));
  } catch {
    usdc = 0;
  }
  return { sol_lamports: Math.max(0, sol), usdc_atomic: usdc };
}

export async function transferSolFromMember(
  env: CustodialEnv,
  fromAccountId: string,
  toPubkeyB58: string,
  lamports: number,
  cluster?: string,
): Promise<{ ok: true; signature: string; fee: number; net: number } | { ok: false; message: string }> {
  const send = Math.floor(lamports);
  if (!Number.isFinite(send) || send < 1) return { ok: false, message: "Amount must be at least 1 lamport." };
  const from = await loadKeypairForAccount(env, fromAccountId);
  if (!from) return { ok: false, message: "Could not unlock your hosted wallet." };
  let dest: PublicKey;
  try {
    dest = new PublicKey(toPubkeyB58);
  } catch {
    return { ok: false, message: "Goal donate address is invalid." };
  }
  if (dest.equals(from.publicKey)) return { ok: false, message: "Cannot donate to the same wallet." };
  const fee = feeFromBps(send, CHAIN_FEE_BPS);
  const net = Math.max(1, send - fee);
  const feePay = send - net;
  const treasuryPk = feePay > 0 ? treasuryPublicKey(env) : null;
  const conn = await pickConnection(env, cluster);
  if (!conn) return { ok: false, message: "Could not reach Solana. Try again shortly." };
  const bal = await conn.getBalance(from.publicKey, "confirmed").catch(() => -1);
  if (bal < 0) return { ok: false, message: "Could not read your SOL balance." };
  const keep = CUSTODIAL_SOL_RESERVE_LAMPORTS + 80_000;
  if (bal - send < keep) {
    const maxSend = Math.max(0, bal - keep);
    return {
      ok: false,
      message: `Not enough spendable SOL. Keep ~${(keep / 1e9).toFixed(4)} SOL for fees. Max now: ${(maxSend / 1e9).toFixed(6)} SOL.`,
    };
  }
  try {
    const latest = await conn.getLatestBlockhash("confirmed");
    const ixs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: TRANSFER_CU }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
      SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: dest, lamports: net }),
    ];
    if (treasuryPk && feePay > 0 && !treasuryPk.equals(dest)) {
      ixs.push(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: treasuryPk, lamports: feePay }));
    }
    const msg = new TransactionMessage({
      payerKey: from.publicKey,
      recentBlockhash: latest.blockhash,
      instructions: ixs,
    });
    const tx = new VersionedTransaction(msg.compileToV0Message());
    tx.sign([from]);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await conn.confirmTransaction(
      { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed",
    );
    return { ok: true, signature: sig, fee: feePay, net };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, message: m.slice(0, 220) };
  }
}

export async function transferUsdcFromMember(
  env: CustodialEnv,
  fromAccountId: string,
  toPubkeyB58: string,
  atomic: number,
  cluster?: string,
): Promise<{ ok: true; signature: string; fee: number; net: number } | { ok: false; message: string }> {
  const raw = Math.floor(atomic);
  if (!Number.isFinite(raw) || raw < 1) return { ok: false, message: "Amount must be at least 1 USDC unit." };
  const from = await loadKeypairForAccount(env, fromAccountId);
  if (!from) return { ok: false, message: "Could not unlock your hosted wallet." };
  let dest: PublicKey;
  try {
    dest = new PublicKey(toPubkeyB58);
  } catch {
    return { ok: false, message: "Goal donate address is invalid." };
  }
  if (dest.equals(from.publicKey)) return { ok: false, message: "Cannot donate to the same wallet." };
  const feePay = feeFromBps(raw, CHAIN_FEE_BPS);
  const net = Math.max(1, raw - feePay);
  const fee = raw - net;
  const conn = await pickConnection(env, cluster);
  if (!conn) return { ok: false, message: "Could not reach Solana. Try again shortly." };
  const mint = new PublicKey(usdcMint(withCluster(env, parseSolanaCluster(cluster) || (await resolveIssueCluster(env)))));
  const fromAta = getAssociatedTokenAddressSync(mint, from.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const toAta = getAssociatedTokenAddressSync(mint, dest, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  let have = 0;
  try {
    const info = await conn.getTokenAccountBalance(fromAta, "confirmed");
    have = Math.floor(Number(info.value.amount) || 0);
  } catch {
    have = 0;
  }
  if (have < raw) {
    return { ok: false, message: `Not enough USDC. You have ${(have / 10 ** USDC_DECIMALS).toFixed(2)} USDC.` };
  }
  const sol = await conn.getBalance(from.publicKey, "confirmed").catch(() => 0);
  if (sol < CUSTODIAL_SOL_RESERVE_LAMPORTS + 80_000) {
    return {
      ok: false,
      message: "Your hosted wallet needs a little SOL for fees. Send SOL to the address on your profile.",
    };
  }
  const treasuryPk = fee > 0 ? treasuryPublicKey(env) : null;
  try {
    const latest = await conn.getLatestBlockhash("confirmed");
    const ixs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
      createAssociatedTokenAccountIdempotentInstruction(
        from.publicKey,
        toAta,
        dest,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      createTransferCheckedInstruction(fromAta, mint, toAta, from.publicKey, net, USDC_DECIMALS, [], TOKEN_PROGRAM_ID),
    ];
    if (treasuryPk && fee > 0 && !treasuryPk.equals(dest)) {
      const feeAta = getAssociatedTokenAddressSync(
        mint,
        treasuryPk,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      ixs.push(
        createAssociatedTokenAccountIdempotentInstruction(
          from.publicKey,
          feeAta,
          treasuryPk,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
        createTransferCheckedInstruction(fromAta, mint, feeAta, from.publicKey, fee, USDC_DECIMALS, [], TOKEN_PROGRAM_ID),
      );
    }
    const msg = new TransactionMessage({
      payerKey: from.publicKey,
      recentBlockhash: latest.blockhash,
      instructions: ixs,
    });
    const tx = new VersionedTransaction(msg.compileToV0Message());
    tx.sign([from]);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await conn.confirmTransaction(
      { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed",
    );
    return { ok: true, signature: sig, fee, net };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, message: m.slice(0, 220) };
  }
}

const SPL_TOKEN_PROGRAMS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];

async function splBalanceForMint(
  conn: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<{ atomic: number; decimals: number; ui: number; programId: PublicKey }> {
  const empty = { atomic: 0, decimals: 6, ui: 0, programId: TOKEN_PROGRAM_ID };
  for (const programId of SPL_TOKEN_PROGRAMS) {
    const ata = getAssociatedTokenAddressSync(mint, owner, false, programId, ASSOCIATED_TOKEN_PROGRAM_ID);
    try {
      const info = await conn.getTokenAccountBalance(ata, "confirmed");
      const atomic = Math.max(0, Math.floor(Number(info.value.amount) || 0));
      if (atomic < 1) continue;
      const decimals = Math.min(12, Math.max(0, Number(info.value.decimals) || 6));
      return { atomic, decimals, ui: atomic / 10 ** decimals, programId };
    } catch {
      /* try the other token program (Pump.fun may be Token-2022) */
    }
  }
  return empty;
}

export async function readSplTokenBalance(
  env: CustodialEnv,
  ownerB58: string,
  mintB58: string,
  cluster?: string,
): Promise<{ atomic: number; decimals: number; ui: number }> {
  const empty = { atomic: 0, decimals: 6, ui: 0 };
  const conn = await pickConnection(env, cluster);
  if (!conn) return empty;
  try {
    const found = await splBalanceForMint(conn, new PublicKey(ownerB58), new PublicKey(mintB58));
    return { atomic: found.atomic, decimals: found.decimals, ui: found.ui };
  } catch {
    return empty;
  }
}

export async function transferSplToTreasury(
  env: CustodialEnv,
  fromAccountId: string,
  mintB58: string,
  atomic: number,
): Promise<{ ok: true; signature: string } | { ok: false; message: string }> {
  const raw = Math.floor(atomic);
  if (raw < 1) return { ok: false, message: "Nothing to swap." };
  const treasury = treasuryKeypair(env);
  if (!treasury) return { ok: false, message: "Ava treasury is not configured." };
  const dest = treasury.publicKey;
  const from = await loadKeypairForAccount(env, fromAccountId);
  if (!from) return { ok: false, message: "Could not unlock your hosted wallet." };
  const conn = await pickConnection(env, "mainnet-beta");
  if (!conn) return { ok: false, message: "Could not reach Solana. Try again shortly." };
  let mint: PublicKey;
  try {
    mint = new PublicKey(mintB58);
  } catch {
    return { ok: false, message: "Ember mint is invalid." };
  }
  const found = await splBalanceForMint(conn, from.publicKey, mint);
  if (found.atomic < raw) return { ok: false, message: "Not enough Ava Embers in your Root wallet." };
  const programId = found.programId;
  const decimals = found.decimals;
  const fromAta = getAssociatedTokenAddressSync(mint, from.publicKey, false, programId, ASSOCIATED_TOKEN_PROGRAM_ID);
  const toAta = getAssociatedTokenAddressSync(mint, dest, false, programId, ASSOCIATED_TOKEN_PROGRAM_ID);
  const tSol = await conn.getBalance(treasury.publicKey, "confirmed").catch(() => 0);
  if (tSol < 80_000) {
    return { ok: false, message: "Ava treasury needs SOL to pay the swap fee." };
  }
  try {
    const latest = await conn.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({
      payerKey: treasury.publicKey,
      recentBlockhash: latest.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
        createAssociatedTokenAccountIdempotentInstruction(
          treasury.publicKey,
          toAta,
          dest,
          mint,
          programId,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
        createTransferCheckedInstruction(fromAta, mint, toAta, from.publicKey, raw, decimals, [], programId),
      ],
    });
    const tx = new VersionedTransaction(msg.compileToV0Message());
    tx.sign([treasury, from]);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await conn.confirmTransaction(
      { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed",
    );
    return { ok: true, signature: sig };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, message: m.slice(0, 220) };
  }
}

export async function handleWalletMe(request: Request, env: CustodialEnv, userId: string): Promise<Response> {
  if (request.method !== "GET") return json({ detail: "Method not allowed" }, 405);
  if (!userId.startsWith("user:")) return json({ detail: "Sign in required." }, 401);
  const email = emailFromUserId(userId);
  const accountId = await accountIdForEmail(env.DB, email);
  if (!accountId) return json({ detail: "Account not found." }, 404);
  const provisioned = await provisionCustodialWalletIfMissing(env, accountId);
  if ("error" in provisioned) return json({ detail: provisioned.error }, 503);
  const wanted = parseSolanaCluster(new URL(request.url).searchParams.get("cluster"));
  const cluster = wanted || (await resolveIssueCluster(env));
  const bal = await readCustodialBalances(env, provisioned.pubkey, cluster);
  const fields = wanted ? clusterPublicFields(withCluster(env, cluster)) : await issuePublicFields(env);
  return json({
    ok: true,
    pubkey: provisioned.pubkey,
    sol_lamports: bal.sol_lamports,
    sol: bal.sol_lamports / 1e9,
    usdc_atomic: bal.usdc_atomic,
    usdc: bal.usdc_atomic / 10 ** USDC_DECIMALS,
    created: provisioned.created,
    ...fields,
  });
}
