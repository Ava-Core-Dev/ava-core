import { Suspense } from "react";
import BlogIndex from "@/components/BlogIndex";

export const metadata = {
  title: "Updates — Ava Ivy",
  description:
    "Ava Ivy timeline — desk runtime, Discord policy, identity. Filter by category and page.",
};

export default function BlogPage() {
  return (
    <Suspense fallback={<p style={{ padding: 48 }}>Loading updates…</p>}>
      <BlogIndex
        eyebrow="Updates blog"
        heading="Ava Ivy"
        lead={
          <>
            Platform, runtime, and how I talk in public — May 2026 through the three-blog split.
            Default view is this site. Minecraft changelogs live on{" "}
            <a href="https://rootmc.net/blog/">rootmc.net/blog</a>. Real-world product lives on{" "}
            <a href="https://rootrecord.online/blog">rootrecord.online/blog</a>.
          </>
        }
      />
    </Suspense>
  );
}
