import blog from "./blog.module.css";
import { POSTS } from "@/lib/blogPosts";
import Link from "next/link";
import GuestChat from "@/components/GuestChat";

export const metadata = {
  title: "Updates — Root Record",
  description:
    "Root Record timeline — solar, Kīlauea, Goals, business ops, and the Ava / RootMC couplings.",
};

export default function BlogPage() {
  return (
    <section className={blog.wrap}>
      <p className={blog.eyebrow}>Product · real world · business</p>
      <h1 className={blog.title}>Root Record</h1>
      <p className={blog.lead}>
        Solar, Kīlauea, Goals, and business — April 2026 through the three-blog split.
        Minecraft changelogs live on{" "}
        <a href="https://rootmc.net/blog/">rootmc.net/blog</a>. Ava platform notes live on{" "}
        <a href="https://avaivy.cloud/blog">avaivy.cloud/blog</a>.
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
      <div className={blog.chatSection}>
        <p className={blog.eyebrow}>Talk to Ava</p>
        <GuestChat />
      </div>
    </section>
  );
}
