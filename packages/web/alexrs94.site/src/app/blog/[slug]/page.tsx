import { notFound } from "next/navigation";
import { BlogPostView } from "@/components/BlogPostView";
import { POSTS, getPost } from "@/lib/blogPosts";

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
  if (!getPost(slug)) notFound();
  return <BlogPostView slug={slug} />;
}
