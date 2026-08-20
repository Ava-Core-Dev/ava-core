"use client";

import { usePathname } from "next/navigation";
import content from "@/content.json";
import styles from "@/app/page.module.css";

export default function SiteChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/live/embed" || path === "/solar") {
    return <>{children}</>;
  }
  const { site, nav, footer } = content;
  return (
    <div className={styles.main}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.logo} href="/">
            <span className={styles.logoMark}>{site.logoMark}</span>
            <span className={styles.logoName}>{site.name}</span>
          </a>
          <nav className={styles.nav}>
            {nav.map((item) => (
              <a key={item.href} href={item.href}>{item.label}</a>
            ))}
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
