import styles from "./StatusCard.module.css";

interface Props {
  title: string;
  value: string;
  sub?: string;
  href?: string;
  accent?: boolean;
}

export default function StatusCard({ title, value, sub, href, accent }: Props) {
  const inner = (
    <div className={`${styles.card} ${accent ? styles.accentBorder : ""}`}>
      <p className={styles.title}>{title}</p>
      <p className={styles.value}>{value}</p>
      {sub && <p className={styles.sub}>{sub}</p>}
    </div>
  );
  return href ? <a href={href} className={styles.link}>{inner}</a> : inner;
}
