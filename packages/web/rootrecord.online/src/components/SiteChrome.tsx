import styles from "@/app/page.module.css";

const NAV = [
  { href: "/", label: "Live" },
  { href: "/goals", label: "Goals" },
  { href: "/blog", label: "Blog" },
  { href: "/reports", label: "Auto Reports" },
  { href: "/timeline", label: "Timeline" },
  { href: "/dev", label: "Dev" },
  { href: "https://avaivy.cloud", label: "Ava Ivy" },
  { href: "https://rootmc.net", label: "RootMC" },
  { href: "https://rootrecord.info", label: "Wiki" },
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
              <a key={item.href} href={item.href}>{item.label}</a>
            ))}
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
