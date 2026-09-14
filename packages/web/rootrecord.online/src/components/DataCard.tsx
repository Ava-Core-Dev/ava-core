import styles from "./DataCard.module.css";

interface Props {
  title: string;
  data: Record<string, any> | null;
  keys?: string[];
  placeholder?: string;
}

function fmt(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function DataCard({ title, data, keys, placeholder }: Props) {
  return (
    <div className={styles.card}>
      <p className={styles.title}>{title}</p>
      {data && keys ? (
        <table className={styles.table}>
          <tbody>
            {keys.map(k => (
              <tr key={k}>
                <td className={styles.key}>{k}</td>
                <td className={styles.val}>{fmt(data[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.placeholder}>{placeholder ?? "No data"}</p>
      )}
    </div>
  );
}
