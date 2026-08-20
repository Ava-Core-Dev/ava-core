import blog from "../blog.module.css";
import { POSTS, getPost, neighbors } from "@/lib/blogPosts";
import Link from "next/link";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "Updates — Root Record" };
  return {
    title: `${post.title} — Root Record`,
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
      <p className={blog.eyebrow}>Root Record · {post.brand}</p>
      <h1 className={blog.title}>{post.title}</h1>
      <p className={blog.lead}>{post.teaser}</p>
      <article className={blog.prose}>
        {post.paragraphs.map((t, i) => (
          <p key={i}>{t}</p>
        ))}
        {post.bullets && post.bullets.length > 0 && (
          <ul>
            {post.bullets.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        )}
        {post.after?.map((t, i) => (
          <p key={`a${i}`}>{t}</p>
        ))}
      </article>
      <nav className={blog.pager} aria-label="Adjacent updates">
        <Link href="/blog">All updates</Link>
        {older ? <Link href={`/blog/${older.slug}`}>← {older.title}</Link> : null}
        {newer ? <Link href={`/blog/${newer.slug}`}>{newer.title} →</Link> : null}
      </nav>
    </section>
  );
}
