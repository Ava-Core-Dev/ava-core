import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";

import { json } from "./cors";
import type { SolanaTxEnv } from "./env";
import { verifyWorkerOpsAdmin } from "./ops-auth";
import { loadRootRecordGlobalUpdaterSigner } from "./root-record-global-updater";
import { confirmSignedTxWithPoll } from "./solana-confirm";

const DEFAULT_ROOTS_MINT = "8hwxLN1Q4Yr8xFErErULCqNvcF1cMwGjpRXPz6DAH7gM";
const RPC_FALLBACKS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
];

function rpcCandidates(env: SolanaTxEnv): string[] {
  const primary = String(env.SOLANA_RPC_URL || "").trim();
  return Array.from(new Set([primary, ...RPC_FALLBACKS].filter(Boolean)));
}

async function pickConnection(env: SolanaTxEnv): Promise<{ connection: Connection; rpcUrl: string } | null> {
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

function parsePositiveIntString(raw: unknown): bigint | null {
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = BigInt(s);
  return n > 0n ? n : null;
}

function uiAmountToRaw(raw: unknown, decimals: number): bigint | null {
  const s = String(raw ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [wholeRaw, fracRaw = ""] = s.split(".");
  if (fracRaw.length > decimals) return null;
  const whole = BigInt(wholeRaw || "0");
  const fracPadded = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
  const frac = fracPadded ? BigInt(fracPadded) : 0n;
  const scale = 10n ** BigInt(decimals);
  const value = whole * scale + frac;
  return value > 0n ? value : null;
}

function rawToUi(raw: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const frac = raw % scale;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

function readString(body: Record<string, unknown>, key: string): string {
  return String(body[key] ?? "").trim();
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

async function readRootsMintMeta(
  connection: Connection,
  env: SolanaTxEnv,
  signerPubkey: PublicKey,
): Promise<
  | { ok: true; mint: PublicKey; tokenProgram: PublicKey; decimals: number }
  | { ok: false; response: Response }
> {
  const mint = new PublicKey(String(env.ROOTS_MINT_BASE58 || DEFAULT_ROOTS_MINT).trim());
  const mintAccount = await connection.getAccountInfo(mint, "confirmed");
  if (!mintAccount) return { ok: false, response: json({ ok: false, detail: "ROOTS mint account not found." }, 503) };
  const tokenProgram = mintAccount.owner;
  const mintInfo = await getMint(connection, mint, "confirmed", tokenProgram);
  const decimalsRaw = String(env.ROOTS_DECIMALS || "").trim();
  const decimals = decimalsRaw && Number.isFinite(Number(decimalsRaw)) ? Math.floor(Number(decimalsRaw)) : mintInfo.decimals;
  if (mintInfo.decimals !== decimals) {
    return {
      ok: false,
      response: json(
        { ok: false, detail: `Configured ROOTS_DECIMALS (${decimals}) does not match mint decimals (${mintInfo.decimals}).` },
        503,
      ),
    };
  }
  if (!mintInfo.mintAuthority || !mintInfo.mintAuthority.equals(signerPubkey)) {
    return {
      ok: false,
      response: json({ ok: false, detail: "Root Record Global Updater is not the mint authority for ROOTS." }, 403),
    };
  }
  return { ok: true, mint, tokenProgram, decimals };
}

export async function handleMintRootsRoute(
  request: Request,
  env: SolanaTxEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (method !== "POST" || sub !== "/internal/mint-roots") return null;
  if (!(await verifyWorkerOpsAdmin(request, env))) {
    return json({ ok: false, detail: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, detail: "Invalid JSON" }, 400);
  }

  const signer = loadRootRecordGlobalUpdaterSigner(env);
  if (!signer.ok) return json({ ok: false, detail: signer.detail }, 503);

  const picked = await pickConnection(env);
  if (!picked) return json({ ok: false, detail: "No working Solana RPC endpoint." }, 503);

  let mint: PublicKey;
  let destinationOwner: PublicKey;
  let feePayer: PublicKey | null = null;
  try {
    mint = new PublicKey(String(env.ROOTS_MINT_BASE58 || DEFAULT_ROOTS_MINT).trim());
    destinationOwner = new PublicKey(readString(body, "destination_owner") || signer.publicKey);
    const feePayerRaw = readString(body, "fee_payer_pubkey");
    feePayer = feePayerRaw ? new PublicKey(feePayerRaw) : null;
  } catch {
    return json({ ok: false, detail: "Invalid ROOTS mint, destination wallet, or fee payer." }, 400);
  }
  const { connection, rpcUrl } = picked;

  const meta = await readRootsMintMeta(connection, env, signer.keypair.publicKey);
  if (!meta.ok) return meta.response;
  const tokenProgram = meta.tokenProgram;
  const decimals = meta.decimals;

  const destinationAta = getAssociatedTokenAddressSync(
    mint,
    destinationOwner,
    false,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  let amountRaw = parsePositiveIntString(body.amount_atomic);
  let mode = "mint_amount";
  const targetRaw = parsePositiveIntString(body.target_atomic);
  let currentRaw = 0n;
  if (!amountRaw && targetRaw) {
    mode = "top_up_to_target";
    const bal = await connection.getTokenAccountBalance(destinationAta, "confirmed").catch(() => null);
    currentRaw = bal?.value?.amount != null ? BigInt(String(bal.value.amount)) : 0n;
    amountRaw = targetRaw > currentRaw ? targetRaw - currentRaw : 0n;
  }
  if (!amountRaw) amountRaw = uiAmountToRaw(body.amount_ui, decimals);
  if (!amountRaw || amountRaw <= 0n) {
    if (targetRaw && currentRaw >= targetRaw) {
      return json({
        ok: true,
        skipped: true,
        detail: "Destination already meets or exceeds the target.",
        mode,
        mint: mint.toBase58(),
        decimals,
        amount_atomic: "0",
        amount_ui: "0",
        destination_owner: destinationOwner.toBase58(),
        destination_ata: destinationAta.toBase58(),
        current_atomic_before: currentRaw.toString(),
        target_atomic: targetRaw.toString(),
        final_atomic: currentRaw.toString(),
      });
    }
    return json({
      ok: false,
      detail: "Provide a positive amount_ui, amount_atomic, or target_atomic.",
      current_atomic: currentRaw.toString(),
      target_atomic: targetRaw?.toString() ?? null,
    }, 400);
  }

  const latest = await connection.getLatestBlockhash("confirmed");
  const payer = feePayer ?? signer.keypair.publicKey;
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2_000 }),
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      destinationAta,
      destinationOwner,
      mint,
      tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    createMintToCheckedInstruction(
      mint,
      destinationAta,
      signer.keypair.publicKey,
      amountRaw,
      decimals,
      [],
      tokenProgram,
    ),
  ];
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: latest.blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([signer.keypair]);
  if (feePayer) {
    return json({
      ok: true,
      mode: "prepare_mint",
      mint: mint.toBase58(),
      decimals,
      amount_atomic: amountRaw.toString(),
      amount_ui: rawToUi(amountRaw, decimals),
      destination_owner: destinationOwner.toBase58(),
      destination_ata: destinationAta.toBase58(),
      fee_payer_pubkey: feePayer.toBase58(),
      transaction_b64: bytesToBase64(tx.serialize()),
      latest_blockhash: latest.blockhash,
      last_valid_block_height: latest.lastValidBlockHeight,
      rpc_url_used: rpcUrl.slice(0, 96),
    });
  }
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await confirmSignedTxWithPoll(connection, signature, latest);

  const finalBal = await connection.getTokenAccountBalance(destinationAta, "confirmed").catch(() => null);
  return json({
    ok: true,
    mode,
    mint: mint.toBase58(),
    decimals,
    amount_atomic: amountRaw.toString(),
    amount_ui: rawToUi(amountRaw, decimals),
    destination_owner: destinationOwner.toBase58(),
    destination_ata: destinationAta.toBase58(),
    current_atomic_before: currentRaw.toString(),
    target_atomic: targetRaw?.toString() ?? null,
    final_atomic: finalBal?.value?.amount ?? null,
    signature,
    explorer: `https://solscan.io/tx/${signature}`,
    rpc_url_used: rpcUrl.slice(0, 96),
  });
}
