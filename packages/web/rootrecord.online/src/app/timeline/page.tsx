import blog from "../blog/blog.module.css";
import { ARCHIVE_REVISED, POSTS, datetimeAttr, formatStamp } from "@/lib/blogPosts";
import Link from "next/link";

export const metadata = {
  title: "Timeline — Root Record",
  description: "Dated Root Record public timeline. Same posts as /blog, with full timestamps.",
};

export default function TimelinePage() {
  return (
    <section className={blog.wrap}>
      <p className={blog.eyebrow}>Archive</p>
      <h1 className={blog.title}>Timeline</h1>
      <p className={blog.lead}>
        Same source as <Link href="/blog">Updates</Link>. Migrations, host moves, and product
        dates with clock times when sourced.
      </p>
      <p className={blog.revised}>Last revised {ARCHIVE_REVISED}</p>
      <ol className={blog.list} style={{ listStyle: "none", padding: 0 }}>
        {POSTS.map((p) => (
          <li key={p.slug} className={blog.card}>
            <div className={blog.meta}>
              <time className={blog.date} dateTime={datetimeAttr(p)}>
                {formatStamp(p)}
              </time>
              <span className={blog.brand}>{p.brand}</span>
            </div>
            <h2>
              <Link href={`/blog/${p.slug}`}>{p.title}</Link>
            </h2>
            <p>{p.teaser}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
