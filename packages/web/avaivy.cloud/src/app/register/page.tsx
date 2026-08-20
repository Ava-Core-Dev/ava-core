"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { goalsFetch, writeToken } from "@/lib/goals-api";
import styles from "../goals/goals.module.css";

function RegisterForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/goals";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const me = await goalsFetch("/v1/me");
      if (cancelled || !me.ok) return;
      const tok = String(me.json.access_token || me.json.token || "");
      if (tok) writeToken(tok);
      router.replace(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const res = await goalsFetch("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const token = String(res.json.access_token || res.json.token || "");
      if (!res.ok || !token) {
        setErr(String(res.json.detail || "Could not create account."));
        return;
      }
      writeToken(token);
      router.push(next);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.main}>
      <div className={styles.form} style={{ margin: "0 auto", maxWidth: 420 }}>
        <section className={styles.hero}>
          <h1>Register</h1>
          <p>Create a Root Record account to post public goals on Ava’s site.</p>
        </section>
        <form onSubmit={submit}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          {err ? <p className={styles.err}>{err}</p> : null}
          <button className={`${styles.btn} ${styles.btnGold}`} disabled={busy} type="submit">
            {busy ? "Creating…" : "Create account"}
          </button>
          <a
            className={`${styles.btn} ${styles.btnGhost}`}
            href={`/login?next=${encodeURIComponent(next)}`}
          >
            Already have an account? Sign in
          </a>
        </form>
      </div>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
