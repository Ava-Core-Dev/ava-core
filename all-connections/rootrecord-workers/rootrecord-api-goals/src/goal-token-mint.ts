/**
 * Custodial SPL mint for a public goal.
 * The poster's hosted wallet (or treasury fallback) pays rent; the per-goal donate wallet is mint authority.
 * Metadata URI points at our public JSON (image hosted on this Worker).
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { Buffer } from "node:buffer";
import {
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
} from "@solana/spl-token";
import bs58 from "bs58";

import { TOKEN_METADATA_PROGRAM_ID } from "./goal-constants";

function u8(n: number): Uint8Array {
  return Uint8Array.of(n & 0xff);
}

function u16le(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function borshString(s: string): Uint8Array {
  const enc = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + enc.length);
  new DataView(out.buffer).setUint32(0, enc.length, true);
  out.set(enc, 4);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function treasuryKeypair(secretB58: string): Keypair | null {
  const raw = String(secretB58 || "").trim();
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(raw));
  } catch {
    return null;
  }
}

function createMetadataV3Ix(params: {
  mint: PublicKey;
  mintAuthority: PublicKey;
  payer: PublicKey;
  updateAuthority: PublicKey;
  name: string;
  symbol: string;
  uri: string;
}) {
  const programId = new PublicKey(TOKEN_METADATA_PROGRAM_ID);
  const [metadata] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("metadata"), programId.toBytes(), params.mint.toBytes()],
    programId,
  );
  const data = concat(
    u8(33),
    borshString(params.name.slice(0, 32)),
    borshString(params.symbol.slice(0, 10)),
    borshString(params.uri.slice(0, 200)),
    u16le(0),
    u8(0),
    u8(0),
    u8(0),
    u8(1),
    u8(0),
  );
  return {
    metadata: metadata.toBase58(),
    ix: {
      keys: [
        { pubkey: metadata, isSigner: false, isWritable: true },
        { pubkey: params.mint, isSigner: false, isWritable: false },
        { pubkey: params.mintAuthority, isSigner: true, isWritable: false },
        { pubkey: params.payer, isSigner: true, isWritable: true },
        { pubkey: params.updateAuthority, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId,
      data: Buffer.from(data),
    },
  };
}

function payerFromSecret(raw: Uint8Array | undefined): Keypair | null {
  if (!raw || (raw.length !== 64 && raw.length !== 32)) return null;
  try {
    if (raw.length === 64) return Keypair.fromSecretKey(raw);
    return Keypair.fromSeed(raw);
  } catch {
    return null;
  }
}

export async function mintGoalToken(params: {
  rpcUrl?: string;
  treasurySecretB58?: string;
  /** Poster's hosted wallet — preferred fee payer when it has SOL on this cluster. */
  payerSecret?: Uint8Array | null;
  donateSecret: Uint8Array;
  name: string;
  symbol: string;
  uri: string;
  decimals?: number;
}): Promise<{ ok: true; mint: string; signature: string } | { ok: false; message: string }> {
  const treasury = treasuryKeypair(params.treasurySecretB58 || "");
  const member = payerFromSecret(params.payerSecret || undefined);
  const payer = member || treasury;
  if (!payer) return { ok: false, message: "treasury_not_configured" };
  const rpc = String(params.rpcUrl || "https://api.devnet.solana.com").trim();
  const decimals = Math.min(9, Math.max(0, Math.floor(Number(params.decimals) || 0)));
  const donate = Keypair.fromSecretKey(params.donateSecret);
  const mintKp = Keypair.generate();
  const conn = new Connection(rpc, "confirmed");

  let lamports: number;
  try {
    lamports = await getMinimumBalanceForRentExemptMint(conn);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "rpc_rent" };
  }

  const { ix: metaIx } = createMetadataV3Ix({
    mint: mintKp.publicKey,
    mintAuthority: donate.publicKey,
    payer: payer.publicKey,
    updateAuthority: donate.publicKey,
    name: params.name,
    symbol: params.symbol,
    uri: params.uri,
  });

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKp.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mintKp.publicKey, decimals, donate.publicKey, donate.publicKey, TOKEN_PROGRAM_ID),
    metaIx,
  );
  tx.feePayer = payer.publicKey;

  try {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.sign(payer, mintKp, donate);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return { ok: true, mint: mintKp.publicKey.toBase58(), signature: sig };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message.slice(0, 240) : "mint_fail" };
  }
}
