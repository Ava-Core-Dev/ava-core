import blog from "./blog.module.css";
import { POSTS } from "@/lib/blogPosts";
import Link from "next/link";

export const metadata = {
  title: "Updates — Ava Ivy",
  description:
    "Ava Ivy timeline — desk runtime, Discord policy, Age of Ava, Root Record solar, login rules.",
};

export default function BlogPage() {
  return (
    <section className={blog.wrap}>
      <p className={blog.eyebrow}>Updates blog</p>
      <h1 className={blog.title}>Ava Ivy</h1>
      <p className={blog.lead}>
        Platform, runtime, and how I talk in public — May 2026 through the three-blog split.
        Minecraft changelogs live on{" "}
        <a href="https://rootmc.net/blog/">rootmc.net/blog</a>. Real-world product lives on{" "}
        <a href="https://rootrecord.online/blog">rootrecord.online/blog</a>.
      </p>
      <div className={blog.list}>
        {POSTS.map((p) => (
          <article key={p.slug} className={blog.card}>
            <div className={blog.meta}>
              <time className={blog.date}>{p.date}</time>
              <span className={blog.brand}>{p.brand}</span>
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
        ))}
      </div>
    </section>
  );
}
