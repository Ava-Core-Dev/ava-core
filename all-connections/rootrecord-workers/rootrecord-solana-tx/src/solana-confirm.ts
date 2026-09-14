import type { Connection } from "@solana/web3.js";

/**
 * Default `confirmTransaction` often throws "block height exceeded" on public RPC under load even when
 * the signature later lands — treat that as soft-fail and poll status (up to ~2m).
 */
export async function confirmSignedTxWithPoll(
  connection: Connection,
  signature: string,
  latest: Readonly<{ blockhash: string; lastValidBlockHeight: number }>,
): Promise<void> {
  try {
    await connection.confirmTransaction(
      { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed",
    );
    return;
  } catch (e) {
    const m = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    if (!/block height exceeded|expired|timeout/i.test(m)) throw e;
    console.warn("solana-tx confirm: blockhash path failed, polling", signature.slice(0, 12), m);
  }
  const maxWaitMs = 120_000;
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const res = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const st = res.value?.[0];
    if (st == null) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (st.err) throw new Error(`on-chain failure: ${JSON.stringify(st.err)}`);
    const c = st.confirmationStatus;
    if (c === "confirmed" || c === "finalized") return;
    if (typeof st.confirmations === "number" && st.confirmations > 0) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`confirmation timeout (${signature.slice(0, 12)}…)`);
}
