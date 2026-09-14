import {
  PublicKey,
  SystemInstruction,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";

/**
 * Treasury tops custodial native SOL up to this floor (see `runRrttCustodialPayoutCron`).
 * Custodial `/sign` keeps at least this much native SOL so the account can pay fees; users fund fees for SOL/USDC/other SPL moves from balance above this floor. RRTT payout fees are subsidized separately by product policy.
 */
/** Floor for treasury SOL top-ups and minimum native SOL custodial should hold (rent + fees). */
export const CUSTODIAL_SOL_RESERVE_LAMPORTS = 1_000_000; // 0.001 SOL

/** Lamports reserved on top of {@link CUSTODIAL_SOL_RESERVE_LAMPORTS} when validating signed spends (tx fee headroom). */
export const CUSTODIAL_SOL_SIGN_FEE_BUFFER_LAMPORTS = 100_000;

/** When custodial is fee payer, assume this much lamports for base fee (no priority); avoids signing SPL-only txs into the reserve. */
export const CUSTODIAL_FEE_PAYER_ESTIMATE_LAMPORTS = 80_000;

/** Sum native SOL leaving the custodial wallet via system transfers in this message. */
export function sumLamportsTransferredFromCustodian(
  instructions: TransactionInstruction[],
  custodial: PublicKey,
): bigint {
  let sum = 0n;
  for (const ix of instructions) {
    try {
      const ty = SystemInstruction.decodeInstructionType(ix);
      if (ty === "Transfer") {
        const d = SystemInstruction.decodeTransfer(ix);
        if (d.fromPubkey.equals(custodial)) sum += BigInt(d.lamports);
      } else if (ty === "TransferWithSeed") {
        const d = SystemInstruction.decodeTransferWithSeed(ix);
        if (d.fromPubkey.equals(custodial)) sum += BigInt(d.lamports);
      }
    } catch {
      /* not a system program instruction this decoder handles */
    }
  }
  return sum;
}

/** Decompile to instructions, or null if bytes are invalid or v0 message needs unresolved lookup tables. */
export function tryDecompileCustodialSignInstructions(raw: Uint8Array): TransactionInstruction[] | null {
  try {
    const vt = VersionedTransaction.deserialize(raw);
    return TransactionMessage.decompile(vt.message).instructions;
  } catch {
    try {
      return Transaction.from(raw).instructions;
    } catch {
      return null;
    }
  }
}

export function custodialSolSpendWouldViolateReserve(
  currentBalanceLamports: number,
  outgoingFromCustodialLamports: bigint,
): boolean {
  const minRemaining = BigInt(CUSTODIAL_SOL_RESERVE_LAMPORTS + CUSTODIAL_SOL_SIGN_FEE_BUFFER_LAMPORTS);
  const bal = BigInt(Math.max(0, Math.floor(currentBalanceLamports)));
  return bal - outgoingFromCustodialLamports < minRemaining;
}

/** If the custodial pubkey pays the tx fee, include a conservative fee debit in reserve math. */
export function estimateFeeIfCustodialPays(raw: Uint8Array, custodial: PublicKey): bigint {
  try {
    const vt = VersionedTransaction.deserialize(raw);
    const k0 = vt.message.staticAccountKeys[0];
    if (k0?.equals(custodial)) return BigInt(CUSTODIAL_FEE_PAYER_ESTIMATE_LAMPORTS);
    return 0n;
  } catch {
    try {
      const lt = Transaction.from(raw);
      return lt.feePayer?.equals(custodial) ? BigInt(CUSTODIAL_FEE_PAYER_ESTIMATE_LAMPORTS) : 0n;
    } catch {
      return 0n;
    }
  }
}
