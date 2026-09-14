"use client";

import { useState } from "react";
import styles from "./wallets.module.css";

export default function CopyAddress({ address }: { address: string }) {
  const [done, setDone] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setDone(true);
      window.setTimeout(() => setDone(false), 1600);
    } catch {
      setDone(false);
    }
  }

  return (
    <button type="button" className={styles.copy} onClick={copy}>
      {done ? "Copied" : "Copy address"}
    </button>
  );
}
