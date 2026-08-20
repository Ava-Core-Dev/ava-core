"use client";

import blog from "@/app/blog/blog.module.css";
import {
  ARCHIVE_REVISED,
  CATEGORIES,
  HOME_BRAND,
  PAGE_SIZE,
  POSTS,
  datetimeAttr,
  formatStamp,
  type BlogPost,
} from "@/lib/blogPosts";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, type ReactNode } from "react";

function catLabel(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export default function BlogIndex({
  eyebrow,
  heading,
  lead,
}: {
  eyebrow: string;
  heading: string;
  lead: ReactNode;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const cat = params.get("cat") || "";
  const focus = params.get("focus") === "all" ? "all" : "site";
  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);

  function setQuery(next: { cat?: string; focus?: string; page?: number }) {
    const q = new URLSearchParams();
    const c = next.cat !== undefined ? next.cat : cat;
    const f = next.focus !== undefined ? next.focus : focus;
    const p = next.page !== undefined ? next.page : 1;
    if (c) q.set("cat", c);
    if (f === "all") q.set("focus", "all");
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }

  const filtered = useMemo(() => {
    return POSTS.filter((p) => {
      if (focus === "site" && p.brand !== HOME_BRAND) return false;
      if (cat && !p.categories.includes(cat)) return false;
      return true;
    });
  }, [cat, focus]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const slice = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <section className={blog.wrap}>
      <p className={blog.eyebrow}>{eyebrow}</p>
      <h1 className={blog.title}>{heading}</h1>
      <p className={blog.lead}>{lead}</p>
      <p className={blog.revised}>
        Archive last revised {ARCHIVE_REVISED}. Full clock times when sourced; otherwise day or
        month precision.
      </p>

      <div className={blog.toggles} role="group" aria-label="Focus">
        <button
          type="button"
          className={`${blog.toggle} ${focus === "site" ? blog.toggleOn : ""}`}
          onClick={() => setQuery({ focus: "site", page: 1 })}
        >
          This site
        </button>
        <button
          type="button"
          className={`${blog.toggle} ${focus === "all" ? blog.toggleOn : ""}`}
          onClick={() => setQuery({ focus: "all", page: 1 })}
        >
          Linked notes
        </button>
      </div>

      <div className={blog.toggles} role="group" aria-label="Categories">
        <button
          type="button"
          className={`${blog.toggle} ${!cat ? blog.toggleOn : ""}`}
          onClick={() => setQuery({ cat: "", page: 1 })}
        >
          All categories
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`${blog.toggle} ${cat === c.id ? blog.toggleOn : ""}`}
            onClick={() => setQuery({ cat: c.id, page: 1 })}
          >
            {c.label}
          </button>
        ))}
      </div>

      <p className={blog.pageMeta}>
        {filtered.length} post{filtered.length === 1 ? "" : "s"} · page {safePage} of {pages}
      </p>

      <div className={blog.list}>
        {slice.length === 0 ? (
          <p className={blog.lead}>No posts in this filter.</p>
        ) : (
          slice.map((p: BlogPost) => (
            <article key={p.slug} className={blog.card}>
              <div className={blog.meta}>
                <time className={blog.date} dateTime={datetimeAttr(p)}>
                  {formatStamp(p)}
                </time>
                <span className={blog.brand}>{p.brand}</span>
              </div>
              <div className={blog.cats}>
                {p.categories.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={blog.catChip}
                    onClick={() => setQuery({ cat: id, page: 1 })}
                  >
                    {catLabel(id)}
                  </button>
                ))}
              </div>
              <h2>
                <Link href={`/blog/${p.slug}`}>{p.title}</Link>
              </h2>
              <p>
                {p.teaser}{" "}
                <Link href={`/blog/${p.slug}`} className={blog.read}>
                  Read
                </Link>
              </p>
            </article>
          ))
        )}
      </div>

      {pages > 1 ? (
        <nav className={blog.pagerRow} aria-label="Blog pages">
          <button
            type="button"
            className={blog.toggle}
            disabled={safePage <= 1}
            onClick={() => setQuery({ page: safePage - 1 })}
          >
            Previous
          </button>
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              className={`${blog.toggle} ${n === safePage ? blog.toggleOn : ""}`}
              onClick={() => setQuery({ page: n })}
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            className={blog.toggle}
            disabled={safePage >= pages}
            onClick={() => setQuery({ page: safePage + 1 })}
          >
            Next
          </button>
        </nav>
      ) : null}
    </section>
  );
}
