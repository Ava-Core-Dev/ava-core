"use client";

import styles from "@/app/page.module.css";
import { AuthBar } from "@/components/AuthBar";
import { goalsFetch } from "@/lib/goals-api";

const NAV = [
  { href: "/", label: "Live" },
  { href: "/status", label: "Status" },
  { href: "/goals", label: "Goals" },
  { href: "/blog", label: "Blog" },
  { href: "/reports", label: "Auto Reports" },
  { href: "/timeline", label: "Timeline" },
  { href: "/dev", label: "Dev" },
  { href: "https://avaivy.cloud", label: "Ava Ivy" },
  { href: "https://rootmc.net", label: "RootMC" },
  { href: "https://rootrecord.info", label: "Root Record" },
];

export default function SiteChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.main}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.brand} href="/">
            <span className={styles.logoMark}>◈</span>
            Root Record
          </a>
          <nav className={styles.nav}>
            {NAV.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
            <AuthBar
              brandLabel="rootrecord.online"
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
          Root Record
          {" "}· <a href="/blog">Blog</a>
          {" "}· <a href="https://avaivy.cloud">Ava Ivy</a>
          {" "}· <a href="https://rootmc.net">RootMC</a>
        </p>
        <p className={styles.footerSub}>Powered by the sun · Big Island, Hawaiʻi</p>
      </footer>
    </div>
  );
}
