"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { goalsFetch, writeToken } from "@/lib/goals-api";
import styles from "../goals/goals.module.css";

function LoginForm({ modeDefault }: { modeDefault: "login" | "signup" }) {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/goals";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">(modeDefault);
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
        setErr(String(res.json.detail || "Sign-in failed."));
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
    <div className={styles.form} style={{ margin: "0 auto", maxWidth: 420 }}>
      <section className={styles.hero}>
        <h1>{mode === "signup" ? "Create a Root Record account" : "Sign in"}</h1>
        <p>
          Same Root Record account used on g.rootrecord.info. Sign in here to post goals on Ava’s
          site.
        </p>
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
          {mode === "login" ? "Need an account? Register" : "Have an account? Sign in"}
        </button>
      </form>
      <p className={styles.meta} style={{ marginTop: 16 }}>
        Chat login for live talk with Ava still uses{" "}
        <a href="https://rootmc.net/login/">rootmc.net</a>. Goals use Root Record email/password.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <main className={styles.main}>
        <LoginForm modeDefault="login" />
      </main>
    </Suspense>
  );
}
