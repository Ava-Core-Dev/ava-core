import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ARCHIVE_REVISED,
  CATEGORIES,
  POSTS,
  datetimeAttr,
  formatStamp,
  getPost,
  neighbors,
} from "@/lib/blogPosts";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "Blog — alexrs94.site" };
  return {
    title: `${post.title} — alexrs94.site`,
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
        {post.sources && post.sources.length > 0 ? (
          <div>
            <p>
              <strong>Sources</strong>
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
      <nav className="grid" aria-label="Adjacent posts" style={{ marginTop: 24 }}>
        <Link href="/blog">All posts</Link>
        {older ? <Link href={`/blog/${older.slug}`}>← {older.title}</Link> : <span />}
        {newer ? <Link href={`/blog/${newer.slug}`}>{newer.title} →</Link> : <span />}
      </nav>
    </main>
  );
}
