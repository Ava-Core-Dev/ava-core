import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

export const ROOT_RECORD_GLOBAL_UPDATER_NAME = "Root Record Global Updater";
export const ROOT_RECORD_GLOBAL_UPDATER_PUBKEY = "G1DHctEcwkiLw8NZDfCbDCbuPktQBmWa6P2aobDuMKuZ";

export type RootRecordGlobalUpdaterEnv = {
  ROOT_RECORD_GLOBAL_UPDATER_SECRET_KEY_B58?: string;
  ROOT_RECORD_GLOBAL_UPDATER_PUBKEY?: string;
};

export type RootRecordGlobalUpdaterSigner =
  | { ok: true; name: typeof ROOT_RECORD_GLOBAL_UPDATER_NAME; publicKey: string; keypair: Keypair }
  | { ok: false; detail: string };

export function expectedRootRecordGlobalUpdaterPubkey(env: RootRecordGlobalUpdaterEnv): string {
  return String(env.ROOT_RECORD_GLOBAL_UPDATER_PUBKEY || ROOT_RECORD_GLOBAL_UPDATER_PUBKEY).trim();
}

export function loadRootRecordGlobalUpdaterSigner(env: RootRecordGlobalUpdaterEnv): RootRecordGlobalUpdaterSigner {
  const secret = String(env.ROOT_RECORD_GLOBAL_UPDATER_SECRET_KEY_B58 || "").trim();
  if (!secret) {
    return { ok: false, detail: "ROOT_RECORD_GLOBAL_UPDATER_SECRET_KEY_B58 is not configured." };
  }

  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecretKey(bs58.decode(secret));
  } catch {
    return { ok: false, detail: "ROOT_RECORD_GLOBAL_UPDATER_SECRET_KEY_B58 could not be decoded." };
  }

  const publicKey = keypair.publicKey.toBase58();
  const expected = expectedRootRecordGlobalUpdaterPubkey(env);
  if (expected && publicKey !== expected) {
    return { ok: false, detail: "Root Record Global Updater signer does not match the configured public wallet." };
  }

  return { ok: true, name: ROOT_RECORD_GLOBAL_UPDATER_NAME, publicKey, keypair };
}
