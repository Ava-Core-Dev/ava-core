import blog from "../../blog/blog.module.css";
import fs from "fs";
import path from "path";

export const revalidate = 300;

function loadDevMd(): string {
  try {
    const p = path.join(process.cwd(), "public", "context-dev.md");
    return fs.readFileSync(p, "utf8");
  } catch {
    return "# Developer context unavailable\n\npublic/context-dev.md missing from this deploy.";
  }
}

export default function ContextDevPage() {
  const md = loadDevMd();
  return (
    <section className={blog.wrap}>
      <p className={blog.eyebrow}>Developer · agent brain</p>
      <h1 className={blog.title}>Ava development context</h1>
      <p className={blog.lead}>
        How to work this system: edit scripts, deploys, Workers, Pages branches, and the public brain.
        Written for humans and coding agents.
      </p>

      <p style={{ marginBottom: "1.25rem", fontSize: 14, lineHeight: 1.7 }}>
        <a href="/context" style={{ color: "var(--accent, #00e5ff)", textDecoration: "underline" }}>
          Live ops context
        </a>
        {" · "}
        <a href="/directory" style={{ color: "var(--accent, #00e5ff)", textDecoration: "underline" }}>
          Directory map
        </a>
        {" · "}
        <a href="/directory.md" style={{ color: "var(--muted)", textDecoration: "underline" }}>
          directory.md
        </a>
        {" · "}
        <a href="/context/dev.md" download style={{ color: "var(--accent, #00e5ff)", textDecoration: "underline" }}>
          Download context-dev.md
        </a>
      </p>

      <pre
        className={blog.card}
        style={{
          whiteSpace: "pre-wrap",
          overflowX: "auto",
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        {md}
      </pre>
    </section>
  );
}

<!-- avaivy-cloud-edit001 20260822T024829Z -->
