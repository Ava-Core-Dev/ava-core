import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

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
              <Link href="/solar">Solar</Link>
              <Link href="/media">Media</Link>
              <Link href="/blog">Blog</Link>
              <a href="https://www.youtube.com/@HIqualityviews">YouTube</a>
              <a href="https://rootrecord.online">Root Record</a>
            </nav>
          </header>
          {children}
          <footer className="footer">
            Built on the Big Island · Public foundation live, details growing over time.
          </footer>
        </div>
      </body>
    </html>
  );
}

