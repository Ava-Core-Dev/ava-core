"use client";

import { useEffect, useMemo, useState } from "react";
import { POSTS, type BlogPost } from "@/lib/blogPosts";

const TOKEN_KEY = "rootrecord_portal_token";
const API_BASE = "https://rootrecord-api-account.rootrecord.workers.dev";
const SITE_KEY = "alexrs94";

export default function StudioClient() {
  const [status, setStatus] = useState("Sign in from the header to edit.");
  const [authed, setAuthed] = useState(false);
  const [slug, setSlug] = useState(POSTS[0]?.slug || "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [overrides, setOverrides] = useState<Record<string, { title: string; body: string }>>({});

  const post = useMemo(() => POSTS.find((p) => p.slug === slug), [slug]);

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) return;
    fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => {
        if (r.ok) setAuthed(true);
      })
      .catch(() => {});
    fetch(`${API_BASE}/public/content/${SITE_KEY}?kind=post`)
      .then((r) => r.json())
      .then((j) => {
        const map: Record<string, { title: string; body: string }> = {};
        for (const it of j.items || []) {
          map[it.path] = { title: it.title || "", body: it.body || "" };
        }
        setOverrides(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!post) return;
    const ov = overrides[post.slug];
    setTitle(ov?.title || post.title);
    setBody(
      ov?.body ||
        [post.paragraphs.join("\n\n"), ...(post.bullets || []).map((b) => `- ${b}`)].join("\n\n"),
    );
  }, [post, overrides]);

  async function save() {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) {
      setStatus("Sign in required.");
      return;
    }
    setStatus("Saving…");
    const r = await fetch(`${API_BASE}/api/content/upsert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${t}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        siteKey: SITE_KEY,
        kind: "post",
        path: slug,
        title,
        body,
        meta: { source: "alexrs94-studio" },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setStatus(j.detail || "Save failed");
      return;
    }
    setOverrides((prev) => ({ ...prev, [slug]: { title, body } }));
    setStatus("Saved override for this post.");
  }

  return (
    <main className="panel">
      <p className="eyebrow">Studio</p>
      <h1 className="title">Edit alexrs94.site posts</h1>
      <p className="lead">
        Logged-in Root Record owners can edit digests. Overrides live in your account content store and
        merge onto the public blog.
      </p>
      <p style={{ color: "var(--muted)", fontSize: 14 }}>{status}</p>
      {!authed ? (
        <p className="lead">Use Sign in in the header first.</p>
      ) : (
        <>
          <label className="studioLabel">
            Post
            <select value={slug} onChange={(e) => setSlug(e.target.value)}>
              {POSTS.map((p: BlogPost) => (
                <option key={p.slug} value={p.slug}>
                  {p.date} — {p.title}
                </option>
              ))}
            </select>
          </label>
          <label className="studioLabel">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="studioLabel">
            Body
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={16} />
          </label>
          <button type="button" className="authBtn primary" onClick={save}>
            Save post
          </button>
        </>
      )}
    </main>
  );
}
