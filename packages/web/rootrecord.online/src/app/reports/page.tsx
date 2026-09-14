import blog from "../blog/blog.module.css";

export const metadata = {
  title: "Auto Reports — Root Record",
  description: "A single public stream of Root Record reports.",
};

export const revalidate = 60;

type CurrentReport = {
  ok?: boolean;
  exists?: boolean;
  text?: string;
  mtimeMs?: number;
};

type ReportFile = {
  name: string;
  kind?: string;
  mtimeMs?: number;
};

type ReportsBoard = {
  generated?: ReportFile[];
};

function hstStamp(ms?: number): string {
  if (!ms) return "Time pending";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Pacific/Honolulu",
  }).format(new Date(ms));
}

function cleanLine(s: string): string {
  return s.replace(/^#+\s*/, "").replace(/^\*\*(.+)\*\*$/, "$1").trim();
}

function currentToParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => cleanLine(p))
    .filter(Boolean);
}

async function getJson<T>(path: string): Promise<T | null> {
  const origin = process.env.AVA_ORIGIN_URL || "https://ava-origin.rootmc.net";
  try {
    const res = await fetch(`${origin}${path}`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function ReportsPage() {
  const [current, board] = await Promise.all([
    getJson<CurrentReport>("/api/reports/current"),
    getJson<ReportsBoard>("/api/reports"),
  ]);

  const text = current?.exists ? String(current?.text || "").trim() : "";
  const paragraphs = text ? currentToParagraphs(text) : [];
  const recent = (board?.generated || []).filter((f) => f.name !== "morning-report-current.md").slice(0, 30);

  return (
    <section className={blog.wrap}>
      <p className={blog.eyebrow}>Root Record feed</p>
      <h1 className={blog.title}>Auto Reports</h1>
      <p className={blog.lead}>
        This page is the public stream for every report. Everything lands in one place so you can
        follow the latest updates without switching pages.
      </p>
      <p className={blog.revised}>Latest refresh: {hstStamp(current?.mtimeMs)}</p>

      <article className={blog.card}>
        <div className={blog.meta}>
          <span className={blog.brand}>Latest report</span>
          <span className={blog.date}>{hstStamp(current?.mtimeMs)}</span>
        </div>
        {paragraphs.length ? (
          <div className={blog.prose}>
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        ) : (
          <p className={blog.lead}>The latest report will appear here shortly.</p>
        )}
      </article>

      <div className={blog.list} style={{ marginTop: 16 }}>
        {recent.map((f) => (
          <article key={f.name} className={blog.card}>
            <div className={blog.meta}>
              <span className={blog.brand}>Report</span>
              <time className={blog.date} dateTime={f.mtimeMs ? new Date(f.mtimeMs).toISOString() : undefined}>
                {hstStamp(f.mtimeMs)}
              </time>
            </div>
            <h2>{f.name.replace(/[-_]/g, " ").replace(/\.md$/i, "")}</h2>
          </article>
        ))}
      </div>
    </section>
  );
}

