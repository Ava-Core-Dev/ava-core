import { AuthBar } from "@/components/AuthBar";
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
/* AuthBar styles live in AuthBar.module.css */

export const metadata: Metadata = {
  title: "alexrs94.site",
  description: "Official site for Alex — solar host operator, creator, and builder.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="top">
            <Link href="/" className="brand">
              alexrs94.site
            </Link>
            <nav className="nav">
              <Link href="/">Home</Link>
              <Link href="/media">Media</Link>
              <Link href="/blog">Blog</Link>
              <Link href="/studio">Studio</Link>
              <a href="https://www.youtube.com/@HIqualityviews">YouTube</a>
              <AuthBar />
            </nav>
          </header>
          {children}
          <footer className="footer">
            Built by <a href="https://avaivy.cloud">Ava</a> on the{" "}
            <a href="https://rootrecord.info">Root Record</a>
            {" · "}
            <a href="https://rootrecord.info/website-hosting">Build your own website</a>
          </footer>
        </div>
      </body>
    </html>
  );
}
