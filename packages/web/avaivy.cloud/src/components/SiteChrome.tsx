"use client";

import { usePathname } from "next/navigation";
import content from "@/content.json";
import styles from "@/app/page.module.css";
import { AuthBar } from "@/components/AuthBar";
import { goalsFetch } from "@/lib/goals-api";

export default function SiteChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  // Full-bleed boards: home (solar desk), solar iframe origin, live embed
  // Full-bleed boards + static wiki HTML (public/wiki) if ever routed through app
  if (
    path === "/" ||
    path === "/live/embed" ||
    path === "/solar" ||
    path === "/status" ||
    path === "/wiki" ||
    path.startsWith("/wiki/")
  ) {
    return <>{children}</>;
  }
  const { site, nav, footer } = content;
  const links = nav.filter((item) => item.href !== "/login" && item.label !== "Sign in");
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
          {footer.links.map((link) => (
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
