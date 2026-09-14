import blog from "../blog/blog.module.css";
import fs from "fs";
import path from "path";

export const revalidate = 300; // refresh shadow inventory every 5 minutes

function loadDirectoryMd(): string {
  // Prefer public/directory.md (written by grok-edit / inventory job)
  const candidates = [
    path.join(process.cwd(), "public", "directory.md"),
    path.join(process.cwd(), "src", "content", "directory.md"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* ignore */
    }
  }
  return [
    "# /home/ava-core/ava — directory map",
    "",
    "Inventory not generated yet. Run the inventory job or grok-edit.py to refresh `public/directory.md`.",
    "",
    "Sensitive paths (credentials.env, keys, wallets) are never exposed here.",
  ].join("\n");
}

export default function DirectoryPage() {
  const md = loadDirectoryMd();
  return (
    <section className={blog.wrap}>
      <p className={blog.eyebrow}>Ops · shadow tree</p>
      <h1 className={blog.title}>Ava directory</h1>
      <p className={blog.lead}>
        Read-only map of <code>/home/ava-core/ava</code> on the OptiPlex. Auto-refreshes from{" "}
        <code>public/directory.md</code>. Non-sensitive text is downloadable for AI agents.
      </p>
      <p style={{ marginBottom: "1.25rem", fontSize: 14 }}>
        <a
          href="/directory.md"
          download
          style={{ color: "var(--accent, #00e5ff)", textDecoration: "underline" }}
        >
          Download directory.md
        </a>
        {" · "}
        <a href="/directory.md" style={{ color: "var(--muted)", textDecoration: "underline" }}>
          Raw markdown
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
