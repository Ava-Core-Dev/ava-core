"use client";

import { useEffect, useState } from "react";
import { FALLBACK_LIVE, type LiveStatus } from "@/lib/live";
import styles from "./LivePlayer.module.css";

type Variant = "home" | "page" | "embed";

function withMute(url: string, mute: boolean) {
  const joiner = url.includes("?") ? "&" : "?";
  const stripped = url.replace(/&mute=\d/g, "").replace(/\?mute=\d&?/g, "?");
  return `${stripped}${joiner}mute=${mute ? 1 : 0}`;
}

export default function LivePlayer({ variant }: { variant: Variant }) {
  const [status, setStatus] = useState<LiveStatus | null>(null);

  useEffect(() => {
    let stop = false;
    const pull = async () => {
      try {
        const res = await fetch("/api/live", { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error("live");
        const data = (await res.json()) as LiveStatus;
        if (!stop) {
          setStatus({ ...FALLBACK_LIVE, ...data, live: !!(data.live || data.streaming) });
        }
      } catch {
        if (!stop) setStatus((prev) => prev ?? { ...FALLBACK_LIVE, live: false });
      }
    };
    pull();
    const id = setInterval(pull, 15000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const live = !!status?.live;
  const src = withMute(status?.embed_url || FALLBACK_LIVE.embed_url, variant === "home");
  const watch = status?.watch_url || FALLBACK_LIVE.watch_url;

  if (variant === "home" && !live) return null;

  if (!live) {
    return (
      <section className={variant === "embed" ? styles.embedOffline : styles.offline}>
        <span className={styles.offlineBadge}>OFF AIR</span>
        <h1 className={styles.offlineTitle}>Ava is not live</h1>
        <p className={styles.offlineSub}>
          This page turns into the YouTube broadcast the moment OBS starts streaming.
        </p>
        <p>
          <a href={watch} target="_blank" rel="noopener noreferrer">
            {status?.channel_handle || "@AvaIvyRootMC"} on YouTube
          </a>
        </p>
      </section>
    );
  }

  const frame = (
    <div className={styles.frameWrap}>
      <iframe
        className={styles.frame}
        src={src}
        title="Ava Ivy live"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );

  if (variant === "embed") {
    return <div className={styles.embedLive}>{frame}</div>;
  }

  if (variant === "home") {
    return (
      <section className={styles.home}>
        <div className={styles.homeHead}>
          <span className={styles.liveBadge}>
            <span className={styles.liveDot} />
            Live now
          </span>
          <a href="/live">Watch on avaivy.cloud/live</a>
        </div>
        {frame}
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <div className={styles.pageHead}>
        <span className={styles.liveBadge}>
          <span className={styles.liveDot} />
          Live now
        </span>
        {status?.scene ? <span className={styles.scene}>{status.scene}</span> : null}
        <a href={watch} target="_blank" rel="noopener noreferrer">
          Open on YouTube
        </a>
      </div>
      {frame}
    </section>
  );
}
