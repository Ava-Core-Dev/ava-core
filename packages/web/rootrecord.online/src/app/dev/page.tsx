"use client";

import blog from "../blog/blog.module.css";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type SessionLike = {
  ok?: boolean;
  email?: string;
  user?: { email?: string };
};

function isRootOperator(session: SessionLike | null): boolean {
  const email = String(session?.email || session?.user?.email || "").toLowerCase();
  return email === "root@rootrecord.info";
}

export default function DevPage() {
  const [session, setSession] = useState<SessionLike | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/session", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive) return;
        setSession(data);
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setSession(null);
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const allowed = useMemo(() => isRootOperator(session), [session]);

  if (!loaded) {
    return (
      <section className={blog.wrap}>
        <p className={blog.lead}>Loading developer tools…</p>
      </section>
    );
  }

  if (!allowed) {
    return (
      <section className={blog.wrap}>
        <p className={blog.eyebrow}>Developer access</p>
        <h1 className={blog.title}>Sign in required</h1>
        <p className={blog.lead}>
          This page is private. Sign in with the root operator account to view runbooks, deploy
          controls, and full system docs.
        </p>
        <nav className={blog.pager}>
          <Link href="/login">Go to login</Link>
          <a href="http://127.0.0.1:8787/ops">Open local ops desk</a>
        </nav>
      </section>
    );
  }

  return (
    <section className={blog.wrap}>
      <p className={blog.eyebrow}>Root Record · developer wiki</p>
      <h1 className={blog.title}>/dev</h1>
      <p className={blog.lead}>
        Central control page for runbooks, deployment, site maps, and daily operations across Ava,
        Root Record, RootMC, and alexrs94.site.
      </p>

      <div className={blog.list}>
        <article className={blog.card}>
          <h2>Operations</h2>
          <ul className={blog.sources}>
            <li><a href="http://127.0.0.1:8787/ops">Local ops desk</a></li>
            <li><a href="http://127.0.0.1:8787/health">Ava health endpoint</a></li>
            <li><code>sudo systemctl restart ava-core.service</code></li>
            <li><code>sudo systemctl status ava-runtime-watchdog.timer</code></li>
          </ul>
        </article>

        <article className={blog.card}>
          <h2>Publishing flow</h2>
          <ul className={blog.sources}>
            <li>Write posts in <code>media/documents/reports/posts/</code></li>
            <li>Rebuild with <code>python3 scripts/sync-blogs.py</code></li>
            <li>Publish RootMC with <code>bash scripts/publish-rootmc.sh</code></li>
            <li>Auto-push timer sends repo updates to GitHub every two minutes</li>
          </ul>
        </article>

        <article className={blog.card}>
          <h2>Site map</h2>
          <ul className={blog.sources}>
            <li><a href="https://rootrecord.online">rootrecord.online</a> — live dashboard + updates</li>
            <li><a href="https://rootmc.net">rootmc.net</a> — Minecraft network + changelog</li>
            <li><a href="https://avaivy.cloud">avaivy.cloud</a> — Ava platform + status</li>
            <li><a href="https://rootrecord.info">rootrecord.info</a> — public wiki</li>
          </ul>
        </article>
      </div>
    </section>
  );
}

