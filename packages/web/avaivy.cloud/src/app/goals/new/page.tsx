"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { goalsFetch } from "@/lib/goals-api";
import { resizeGoalImage } from "@/lib/resize-goal-image";
import styles from "../goals.module.css";

export default function NewAvaGoalPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [goalType, setGoalType] = useState<"money" | "non_money">("money");
  const [cost, setCost] = useState("");
  const [symbol, setSymbol] = useState("");
  const [percent, setPercent] = useState("0");
  const [targetDate, setTargetDate] = useState("");
  const [preview, setPreview] = useState("");
  const [image, setImage] = useState("");
  const [info, setInfo] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showMemberGate, setShowMemberGate] = useState(false);
  const money = goalType === "money";

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
      const body: Record<string, unknown> = {
        title,
        purpose,
        public: true,
        public_enabled: true,
        requires_money: money,
        percent_complete: Math.max(0, Math.min(100, Math.floor(Number(percent) || 0))),
        target_date_est: targetDate.trim() || null,
        image_base64: image,
      };
      if (money) {
        body.estimated_cost_cents = cost ? Math.round(Number(cost) * 100) : null;
        body.token_symbol = symbol.trim().toUpperCase().slice(0, 8);
      } else {
        body.estimated_cost_cents = null;
      }
      const res = await goalsFetch("/api/goals", {
        method: "POST",
        body: JSON.stringify(body),
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
      if (id) router.push(`/goals/view?id=${encodeURIComponent(id)}`);
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
          Uses your Root Record account. Each goal gets its own donate wallet. Members can post;
          Ava’s posts show as Ava · server.
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
          Goal type
          <select
            value={goalType}
            onChange={(e) => setGoalType(e.target.value === "non_money" ? "non_money" : "money")}
          >
            <option value="money">Money — raise funds</option>
            <option value="non_money">Non-monetary — track progress</option>
          </select>
        </label>
        {money ? (
          <>
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
          </>
        ) : (
          <>
            <label>
              Percent complete
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
              />
            </label>
            <label>
              Estimated completion date
              <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </label>
          </>
        )}
        <label>
          Goal image (token artwork)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => void onFile(e.target.files?.[0])}
            required
          />
        </label>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.preview} src={preview} alt="Token artwork preview" />
        ) : null}
        {info ? <p className={styles.ok}>{info}</p> : null}
        {err ? <p className={styles.err}>{err}</p> : null}
        <button
          className={`${styles.btn} ${styles.btnGold}`}
          disabled={busy || !title || !image || showMemberGate}
          type="submit"
        >
          {busy ? "Creating…" : "Publish goal"}
        </button>
      </form>
      {showMemberGate ? (
        <div className={styles.modalScrim}>
          <div className={styles.modalCard} role="dialog" aria-labelledby="gateTitle">
            <h2 id="gateTitle">Members post public goals</h2>
            <p>
              Create a Root Record account and membership to publish a goal with its own wallet.
              Anyone can browse and donate.
            </p>
            <div className={styles.modalActions}>
              <a className={`${styles.btn} ${styles.btnGold}`} href="/register?next=/goals/new">
                Register
              </a>
              <a className={`${styles.btn} ${styles.btnGhost}`} href="/login?next=/goals/new">
                Sign in
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
