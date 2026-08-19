"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { goalsFetch, writeToken } from "@/lib/goals-api";
import styles from "../goals/goals.module.css";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/goals/new";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
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
      const path = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const res = await goalsFetch(path, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const token = String(res.json.access_token || res.json.token || "");
      if (!res.ok || !token) {
        const detail = String(res.json.detail || "Sign-in failed.");
        setErr(detail);
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
        <div className={styles.form} style={{ margin: "0 auto" }}>
          <section className={styles.hero}>
            <h1>{mode === "signup" ? "Create a Root Record account" : "Sign in"}</h1>
            <p>Email and password for your Root Record account. Anyone can join.</p>
          </section>
          <form onSubmit={submit} className={styles.form}>
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
              />
            </label>
            {err ? <p className={styles.err}>{err}</p> : null}
            <button className={`${styles.btn} ${styles.btnGold}`} disabled={busy} type="submit">
              {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
            >
              {mode === "login" ? "Need an account?" : "Have an account?"}
            </button>
          </form>
        </div>
      </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
