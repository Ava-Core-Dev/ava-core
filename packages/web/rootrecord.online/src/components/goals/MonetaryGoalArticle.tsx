import type { PublicGoal } from "@/lib/goals-api";
import styles from "../../app/goals/goals.module.css";

/** Legal + process copy shown under monetary progress on goal detail pages. */
export default function MonetaryGoalArticle({ goal }: { goal: PublicGoal }) {
  const symbol = goal.token_symbol || "GOAL";
  const cluster = goal.solana_cluster || goal.token_cluster || "devnet";

  return (
    <article className={styles.moneyArticle}>
      <h2>How monetary goals work</h2>
      <p className={styles.legal}>
        <strong>Legal disclaimer.</strong> Contributions to Root Goals are voluntary support for a
        stated project target. They are not an investment contract, equity, debt, security, profit
        share, or guarantee of any return. Goal tokens track funding progress for that isolated goal
        only and have no promised cash value. Root Record may change fees, networks, or tooling.
        Crypto transfers are irreversible once confirmed. Card payments are processed by Stripe; Root
        Record never stores full card numbers. Do not contribute funds you cannot afford to lose.
        Nothing here is legal, tax, or financial advice — check local law before donating or holding
        tokens.
      </p>
      <h3>Isolated wallet</h3>
      <p>
        Each monetary goal gets its own custodial Solana address. Deposits for this goal stay on that
        address until the creator withdraws after the target is met, or refunds close the goal. Ava
        server goals are posted by Ava&apos;s own Root Record account; community goals stay under the
        member who posted them.
      </p>
      <h3>What counts as raised</h3>
      <p>
        The meter uses landed value after platform fees: <strong>5%</strong> on card donations
        (Stripe&apos;s processing fee is additional) and <strong>2.5%</strong> on SOL / USDC
        transfers. Hosted Root-wallet sends and Ava Shards follow the same goal ledger rules. ATA
        rent and network fees can reduce what remains for refunds.
      </p>
      <h3>Goal tokens ({symbol})</h3>
      <ul>
        <li>100 goal tokens equal 100% of the USD target for this goal.</li>
        <li>
          A $1 landed deposit on a $100 goal mints about 1 token after ATA rent; overfunding still
          mints past 100%.
        </li>
        <li>
          Tokens mint to the contributor&apos;s Root wallet on Solana <strong>{cluster}</strong>{" "}
          (mainnet when the treasury has ≥ 0.01 SOL, otherwise devnet).
        </li>
        <li>Token status starts pending until the first successful mint path is ready.</li>
      </ul>
      <h3>Withdrawals &amp; cancel</h3>
      <p>
        Creators cannot withdraw until the target is met. Canceling refunds what remains after ATA
        rent and transaction fees. New deposits after a withdraw can still mint tokens. Always verify
        the QR / address on this page before sending crypto.
      </p>
    </article>
  );
}
