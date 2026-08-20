import { Suspense } from "react";
import BlogIndex from "@/components/BlogIndex";
import GuestChat from "@/components/GuestChat";
import blog from "./blog.module.css";

export const metadata = {
  title: "Updates — Root Record",
  description:
    "Root Record timeline — solar, Kīlauea, Goals, business. Filter by category and page.",
};

export default function BlogPage() {
  return (
    <>
      <Suspense fallback={<p style={{ padding: 48 }}>Loading updates…</p>}>
        <BlogIndex
          eyebrow="Product · real world · Hawaiʻi"
          heading="Root Record"
          lead={
            <>
              Solar, Kīlauea, Goals, and business — April 2026 through the three-blog split.
              Default view is this site. Minecraft changelogs live on{" "}
              <a href="https://rootmc.net/blog/">rootmc.net/blog</a>. Ava platform notes live on{" "}
              <a href="https://avaivy.cloud/blog">avaivy.cloud/blog</a>.
            </>
          }
        />
      </Suspense>
      <section className={blog.wrap} style={{ paddingTop: 0 }}>
        <div className={blog.chatSection}>
          <p className={blog.eyebrow}>Talk to Ava</p>
          <GuestChat />
        </div>
      </section>
    </>
  );
}
