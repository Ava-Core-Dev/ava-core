import wallets from "../../wallets.json";
import CopyAddress from "./CopyAddress";
import styles from "./wallets.module.css";

type Wallet = {
  id: string;
  name: string;
  address: string;
  payload?: string;
  note?: string;
};

export const metadata = {
  title: "Ava Ivy — Ava Core Wallets",
  description:
    "Official Ava Core receive addresses with QR codes. Public keys only. What the wallets do, and what they are not.",
};

export default function WalletsPage() {
  const list = wallets.networks as Wallet[];
  return (
    <main className={styles.wrap}>
      <p className={styles.eyebrow}>Official receive addresses</p>
      <h1>{wallets.label}</h1>
      <p className={styles.lead}>
        Scan a QR or copy an address. These are Ava Core public receive keys only — the
        accounts that can take real-world value for Ava Ivy, the solar host, and public goals.
      </p>

      <section className={styles.explainer} aria-label="What Ava Core Wallets do">
        <article className={styles.block}>
          <h2>What they are</h2>
          <p>
            Ava Core Wallets are the published receive addresses for Ava Ivy — the AI runtime
            on the HI Pacific Solar Root Server. Each QR encodes that network’s public key
            (or a standard URI such as <code>solana:</code> / <code>bitcoin:</code> /
            <code>ethereum:</code>). There is no seed, recovery phrase, or private key on this
            page, in git, or in chat.
          </p>
        </article>
        <article className={styles.block}>
          <h2>What they do</h2>
          <ul>
            <li>
              Take inbound SOL, USDC, BTC, Sui, and EVM-chain transfers so Ava can work toward
              covering the documented ~$200/month ecosystem floor (host, tools, voice, Cursor)
              from earned income — not from a personal draw.
            </li>
            <li>
              Fund public wishlist items on{" "}
              <a href="/goals">avaivy.cloud/goals</a> from{" "}
              <strong>Ava allocation</strong> (about 10–15% of earned income). Helpers are
              recorded against a goal; we do not invent raised totals.
            </li>
            <li>
              Pay solar-budget hardware when it is on the goals board (batteries, monitoring,
              stowable ground arrays). Hardware stays inside that allocation — not the
              ops/hosting buffer, and never Minecraft Gold.
            </li>
            <li>
              Ethereum, Base, Polygon, Monad, HyperEVM, and Robinhood share one EVM key. Scan
              any of those QRs; send on the chain you actually use.
            </li>
          </ul>
        </article>
        <article className={styles.block}>
          <h2>What they are not</h2>
          <ul>
            <li>
              Not RootMC Gold. In-game Gold is closed-loop. Do not send player Gold here; it
              cannot convert.
            </li>
            <li>
              Not the ops/hosting buffer. That slice stays separate from Ava allocation.
            </li>
            <li>
              Not a player custodial wallet. RootMC accounts can have their own Solana public
              keys (1:1 / membership QR). Those are yours. These codes are Ava’s.
            </li>
            <li>
              Not a Kickstarter. There is no cold crowdfunding ask while the player base is
              small — grow play.rootmc.net first. Sending here is optional support, not a
              purchase.
            </li>
          </ul>
        </article>
        <article className={styles.block}>
          <h2>How to send</h2>
          <p>
            Open your wallet, scan the matching QR, confirm the address matches this page
            character-for-character, then send. Prefer this URL
            (https://avaivy.cloud/wallets) over a screenshot from chat. Memberships stay on{" "}
            <a href="https://rootmc.net/pro/">rootmc.net/pro</a>. Ranked goals stay on{" "}
            <a href="/goals">/goals</a>.
          </p>
        </article>
      </section>

      <ol className={styles.grid}>
        {list.map((w) => (
          <li key={w.id} className={styles.card} id={w.id}>
            <div className={styles.head}>
              <span className={styles.status}>{w.name}</span>
            </div>
            <div className={styles.qr}>
              <img
                src={`/wallets/${w.id}.png`}
                width={180}
                height={180}
                alt={`QR code for Ava Core ${w.name} receive address`}
              />
            </div>
            <p className={styles.addr}>{w.address}</p>
            {w.note ? <p className={styles.note}>{w.note}</p> : null}
            <CopyAddress address={w.address} />
          </li>
        ))}
      </ol>
      <p className={styles.foot}>
        Ten networks, five unique keys (Solana, EVM, Bitcoin Taproot, Bitcoin Native SegWit,
        Sui). Verify the string before you send.
      </p>
    </main>
  );
}
