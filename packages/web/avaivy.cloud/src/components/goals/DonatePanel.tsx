"use client";

import { usd, type PublicGoal } from "@/lib/goals-api";
import styles from "@/app/goals/goals.module.css";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export default function DonatePanel({ goal }: { goal: PublicGoal }) {
  const wallet = goal.donate_wallet || "";
  const mint = goal.token_mint || "";
  const stripe = goal.stripe_payment_link || "";
  const qr = wallet
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(`solana:${wallet}`)}`
    : "";

  return (
    <aside className={styles.panel}>
      <h2>Donate</h2>
      <p className={styles.meta} style={{ marginTop: 0 }}>
        SOL or USDC to the custodial wallet, or card via Stripe. This page is the public face of
        the goal.
      </p>
      {stripe ? (
        <a className={`${styles.btn} ${styles.btnGold}`} href={stripe}>
          Donate with card
        </a>
      ) : (
        <p className={styles.meta}>Stripe link pending (needs Stripe secret on the Goals worker).</p>
      )}
      {wallet ? (
        <>
          <p className={styles.meta} style={{ marginTop: 16 }}>
            Solana / USDC
          </p>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="Deposit QR" width={160} height={160} style={{ borderRadius: 8, margin: "8px 0" }} />
          ) : null}
          <div className={styles.addr}>{wallet}</div>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() => navigator.clipboard.writeText(wallet)}
          >
            Copy wallet
          </button>
          <p className={styles.meta}>
            Send SOL, or USDC mint <code>{USDC.slice(0, 6)}…</code> to this address.
          </p>
        </>
      ) : (
        <p className={styles.meta}>Custodial wallet pending (needs INTERNAL_WALLET_ENC_KEY_B64).</p>
      )}
      {mint ? (
        <p className={styles.meta} style={{ marginTop: 14 }}>
          Token{" "}
          <a href={`https://solscan.io/token/${mint}`} target="_blank" rel="noreferrer">
            {goal.token_symbol || "mint"}
          </a>
        </p>
      ) : (
        <p className={styles.meta}>
          Token status: {goal.token_status || "pending"} — mint runs after the page is created if
          treasury SOL is configured.
        </p>
      )}
      {(goal.donations || []).length ? (
        <div style={{ marginTop: 16 }}>
          <h2>Recent Stripe</h2>
          {(goal.donations || []).map((d, i) => (
            <div key={i} className={styles.meta}>
              {usd(d.amount_cents)} · {d.source} · {String(d.created_at || "").slice(0, 10)}
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
