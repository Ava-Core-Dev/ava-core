"use client";

import { usePathname } from "next/navigation";
import content from "@/content.json";
import styles from "@/app/page.module.css";
import { AuthBar } from "@/components/AuthBar";
import { goalsFetch } from "@/lib/goals-api";

export default function SiteChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (
    path === "/live/embed" ||
    path === "/wiki" ||
    path.startsWith("/wiki/") ||
    path === "/status" ||
    path === "/solar"
  ) {
    return <>{children}</>;
  }
  const { site, nav, footer } = content;
  // HARD RULE: do not grow top nav. content.json nav is the only source;
  // never invent extra doors here. Operator ask required to add a link.
  // Overlaps (Solar=/status, Timeline=/blog, Directory/Wiki via Context) stay off nav.
  const links = nav.filter((item) => item.href !== "/login" && item.label !== "Sign in");
  const navKeys = new Set(
    links.map((item) => item.href.replace(/\/$/, "").toLowerCase()),
  );
  // One path per destination: never repeat a nav href in the footer.
  const footerLinks = footer.links.filter(
    (link) => !navKeys.has(link.href.replace(/\/$/, "").toLowerCase()),
  );
  return (
    <div className={styles.main}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.logo} href="/">
            <span className={styles.logoMark}>{site.logoMark}</span>
            <span className={styles.logoName}>{site.name}</span>
          </a>
          <nav className={styles.nav}>
            {links.map((item) => (
              <a key={item.href} href={item.href}>{item.label}</a>
            ))}
            <AuthBar
              brandLabel="avaivy.cloud"
              onAccountOk={async (email, password) => {
                await goalsFetch("/api/auth/login", {
                  method: "POST",
                  body: JSON.stringify({ email, password }),
                });
              }}
            />
          </nav>
        </div>
      </header>
      {children}
      <footer className={styles.footer}>
        <p>
          {site.name}
          {footerLinks.map((link) => (
            <span key={link.href}>
              {" "}
              · <a href={link.href}>{link.label}</a>
            </span>
          ))}
        </p>
        <p className={styles.footerSub}>{footer.tagline}</p>
      </footer>
    </div>
  );
}
