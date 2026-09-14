import Link from "next/link";
import { POSTS, datetimeAttr, formatStamp } from "@/lib/blogPosts";

export const metadata = {
  title: "Blog — alexrs94.site",
  description: "Personal notes from Alex — solar, media, and site updates.",
};

export default function BlogPage() {
  return (
    <main className="panel">
      <p className="eyebrow">Blog</p>
      <h1 className="title">Notes from the desk</h1>
      <p className="lead">
        Personal updates for alexrs94.site. Brand changelogs stay on{" "}
        <a href="https://avaivy.cloud/blog">Ava</a>,{" "}
        <a href="https://rootrecord.online/blog">Root Record</a>, and{" "}
        <a href="https://rootmc.net/blog/">RootMC</a>.
      </p>
      <div className="grid">
        {POSTS.map((p) => (
          <article key={p.slug} className="tile">
            <p className="eyebrow">
              <time dateTime={datetimeAttr(p)}>{formatStamp(p)}</time>
            </p>
            <h2 className="sectionTitle">
              <Link href={`/blog/${p.slug}`}>{p.title}</Link>
            </h2>
            <p className="lead">{p.teaser}</p>
            <Link href={`/blog/${p.slug}`}>Read</Link>
          </article>
        ))}
      </div>
      {POSTS.length === 0 ? <p className="lead">No posts yet.</p> : null}
    </main>
  );
}
