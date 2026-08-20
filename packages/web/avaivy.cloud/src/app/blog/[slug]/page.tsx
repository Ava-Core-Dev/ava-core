import blog from "../blog.module.css";
import { POSTS, getPost, neighbors, mediaUrl } from "@/lib/blogPosts";
import Link from "next/link";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "Updates — Ava Ivy" };
  return {
    title: `${post.title} — Ava Ivy`,
    description: post.teaser,
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();
  const { older, newer } = neighbors(slug);

  return (
    <section className={blog.wrap}>
      <p className={blog.crumb}>
        <Link href="/blog">Updates</Link> · {post.date}
      </p>
      <p className={blog.eyebrow}>Ava Ivy · {post.brand}</p>
      <h1 className={blog.title}>{post.title}</h1>
      <p className={blog.lead}>{post.teaser}</p>
      {post.audio && post.audio.length > 0 ? (
        <div className={blog.audioBox}>
          {post.audio.map((src) => (
            <figure key={src}>
              <figcaption>Listen — {src.split("/").pop()}</figcaption>
              <audio controls preload="none" src={mediaUrl(src)}>
                <a href={mediaUrl(src)}>Download audio</a>
              </audio>
            </figure>
          ))}
        </div>
      ) : null}
      <article className={blog.prose}>
        {post.paragraphs.map((t) => (
          <p key={t.slice(0, 48)}>{t}</p>
        ))}
        {post.bullets && post.bullets.length > 0 && (
          <ul>
            {post.bullets.map((t) => (
              <li key={t.slice(0, 48)}>{t}</li>
            ))}
          </ul>
        )}
        {post.after?.map((t) => (
          <p key={t.slice(0, 48)}>{t}</p>
        ))}
        {post.sources && post.sources.length > 0 ? (
          <div className={blog.sources}>
            <p>
              <strong>Sources (URLs)</strong>
            </p>
            <ul>
              {post.sources.map((href) => (
                <li key={href}>
                  <a href={href}>{href}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </article>
      <nav className={blog.pager} aria-label="Adjacent updates">
        <Link href="/blog">All updates</Link>
        {older ? <Link href={`/blog/${older.slug}`}>← {older.title}</Link> : <span />}
        {newer ? <Link href={`/blog/${newer.slug}`}>{newer.title} →</Link> : <span />}
      </nav>
    </section>
  );
}
