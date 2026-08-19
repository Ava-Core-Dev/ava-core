import styles from "./StatTile.module.css";

type PillColor = "green" | "red" | "amber" | "cyan" | "orange";

interface Props {
  label: string;
  value: string;
  pill: PillColor;
  sub?: string;
}

export default function StatTile({ label, value, pill, sub }: Props) {
  return (
    <div className={styles.tile}>
      <p className={styles.label}>{label}</p>
      <p className={styles.value}>{value}</p>
      {sub && <p className={styles.sub}>{sub}</p>}
      <span className={`pill pill-${pill} ${styles.pill}`}>
        <span className="dot" style={{ background: `var(--${pill === "amber" ? "accent" : pill})` }} />
        {pill}
      </span>
    </div>
  );
}
