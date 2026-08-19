"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { goalsFetch } from "@/lib/goals-api";
import { resizeGoalImage } from "@/lib/resize-goal-image";
import styles from "../goals.module.css";

export default function NewGoalPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [cost, setCost] = useState("");
  const [symbol, setSymbol] = useState("");
  const [preview, setPreview] = useState("");
  const [image, setImage] = useState("");
  const [info, setInfo] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showMemberGate, setShowMemberGate] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await goalsFetch("/api/profile");
      if (res.status === 401) {
        router.push("/login?next=/goals/new");
        return;
      }
      if (!res.ok || !res.json.can_post_goals) setShowMemberGate(true);
    })();
  }, [router]);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setErr("");
    setInfo("");
    setImage("");
    setPreview("");
    try {
      const out = await resizeGoalImage(f);
      setImage(out.dataUrl);
      setPreview(out.dataUrl);
      setInfo(`Ready: ${out.dim}×${out.dim} JPEG, ${out.kb} KB.`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not resize image.");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const res = await goalsFetch("/api/goals", {
        method: "POST",
        body: JSON.stringify({
          title,
          purpose,
          estimated_cost_cents: cost ? Math.round(Number(cost) * 100) : null,
          token_symbol: symbol.trim().toUpperCase().slice(0, 8),
          public: true,
          public_enabled: true,
          requires_money: true,
          image_base64: image,
        }),
      });
      if (res.status === 401) {
        router.push("/login?next=/goals/new");
        return;
      }
      if (!res.ok) {
        setErr(String(res.json.detail ?? "Could not create goal."));
        return;
      }
      const created = res.json.goal as { id?: string } | undefined;
      const id = String(created?.id || "");
      if (id) router.push(`/goals/${id}`);
      else setErr("Created, but no id came back.");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className={styles.hero}>
        <h1>Post a public goal</h1>
        <p>
          Upload the image that will mint as the token face. We create a custodial Solana wallet
          for SOL/USDC and a Stripe payment link. Ava&apos;s official posts show as Ava · server.
        </p>
      </section>
      <form className={styles.form} onSubmit={submit}>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={80} />
        </label>
        <label>
          What this is for
          <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} required />
        </label>
        <label>
          Target (USD, optional)
          <input
            type="number"
            min="0"
            step="1"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="2500"
          />
        </label>
        <label>
          Token symbol (optional)
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            maxLength={8}
            placeholder="AVAOPS"
          />
        </label>
        <label>
          Goal image (token artwork)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => void onFile(e.target.files?.[0])}
            required
          />
        </label>
        <p className={styles.meta} style={{ marginTop: 0 }}>
          Large photos are auto-cropped square and compressed for the token. GIFs become a still
          frame.
        </p>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.preview} src={preview} alt="Token artwork preview" />
        ) : null}
        {info ? <p className={styles.ok}>{info}</p> : null}
        {err ? <p className={styles.err}>{err}</p> : null}
        <button className={`${styles.btn} ${styles.btnGold}`} disabled={busy || !title || !image || showMemberGate} type="submit">
          {busy ? "Minting page…" : "Publish goal"}
        </button>
      </form>
      {showMemberGate ? (
        <div className={styles.modalScrim}>
          <div className={styles.modalCard} role="dialog" aria-labelledby="gateTitle">
            <h2 id="gateTitle">Members post public goals</h2>
            <p>
              This page is how Root Record turns a real project into a public goal: title, purpose,
              artwork, optional USD target, and a token face. Donors send SOL, USDC, or card. You
              withdraw only after the target is met.
            </p>
            <ul>
              <li>Artwork becomes the goal token image</li>
              <li>A donate wallet is created with the post</li>
              <li>100 tokens = 100% of the USD target</li>
              <li>Only members can create goals. Anyone can donate.</li>
            </ul>
            <div className={styles.modalActions}>
              <a className={`${styles.btn} ${styles.btnGold}`} href="https://g.rootrecord.info/memberships">
                Get membership to create goals
              </a>
              <a className={`${styles.btn} ${styles.btnGhost}`} href="/goals">
                Browse public goals
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
