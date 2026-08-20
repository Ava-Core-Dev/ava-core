"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ARCHIVE_REVISED,
  CATEGORIES,
  datetimeAttr,
  formatStamp,
  getPost,
  neighbors,
  type BlogPost,
} from "@/lib/blogPosts";

const API_BASE = "https://rootrecord-api-account.rootrecord.workers.dev";
const SITE_KEY = "alexrs94";

export function BlogPostView({ slug }: { slug: string }) {
  const base = getPost(slug);
  const [post, setPost] = useState<BlogPost | null>(base || null);

  useEffect(() => {
    if (!base) return;
    fetch(`${API_BASE}/public/content/${SITE_KEY}/post/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.item) return;
        const body = String(j.item.body || "");
        const paras = body
          .split(/\n\s*\n/)
          .map((p: string) => p.trim())
          .filter(Boolean)
          .filter((p: string) => !p.startsWith("- "));
        const bullets = body
          .split("\n")
          .map((l: string) => l.trim())
          .filter((l: string) => l.startsWith("- "))
          .map((l: string) => l.slice(2).trim());
        setPost({
          ...base,
          title: j.item.title || base.title,
          paragraphs: paras.length ? paras : base.paragraphs,
          bullets: bullets.length ? bullets : base.bullets,
        });
      })
      .catch(() => {});
  }, [slug, base]);

  if (!post) return null;
  const { older, newer } = neighbors(slug);

  return (
    <main className="panel">
      <p className="eyebrow">
        <Link href="/blog">Blog</Link>
        {post.categories.map((id) => (
          <span key={id}>
            {" · "}
            {CATEGORIES.find((c) => c.id === id)?.label ?? id}
          </span>
        ))}
      </p>
      <h1 className="title">{post.title}</h1>
      <p className="lead">
        <time dateTime={datetimeAttr(post)}>{formatStamp(post)}</time>
        {" · "}revised {ARCHIVE_REVISED}
      </p>
      <p className="lead">{post.teaser}</p>
      <article>
        {post.paragraphs.map((t) => (
          <p key={t.slice(0, 48)} className="lead">
            {t}
          </p>
        ))}
        {post.bullets && post.bullets.length > 0 ? (
          <ul>
            {post.bullets.map((t) => (
              <li key={t.slice(0, 48)}>{t}</li>
            ))}
          </ul>
        ) : null}
        {post.after?.map((t) => (
          <p key={t.slice(0, 48)} className="lead">
            {t}
          </p>
        ))}
      </article>
      <nav className="grid" aria-label="Adjacent posts" style={{ marginTop: 24 }}>
        <Link href="/blog">All posts</Link>
        {older ? <Link href={`/blog/${older.slug}`}>← {older.title}</Link> : <span />}
        {newer ? <Link href={`/blog/${newer.slug}`}>{newer.title} →</Link> : <span />}
      </nav>
    </main>
  );
}
