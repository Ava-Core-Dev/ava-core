import blog from "../blog/blog.module.css";
import { sanitizeVendorDeep, sanitizeVendorNames } from "../../lib/sanitizeVendorNames";

export const revalidate = 60;

async function getContext() {
  try {
    const r = await fetch(
      `${process.env.AVA_ORIGIN_URL || "https://ava-origin.rootmc.net"}/api/context`,
      { next: { revalidate: 60 }, signal: AbortSignal.timeout(5000) }
    );
    if (r.ok) return sanitizeVendorDeep(await r.json());
  } catch {}
  return null;
}

function renderContext(ctx: Record<string, unknown>): string {
  if (typeof ctx.content === "string") return sanitizeVendorNames(ctx.content);
  return sanitizeVendorNames(JSON.stringify(ctx, null, 2));
}

export default async function ContextPage() {
  const ctx = await getContext();

  return (
    <section className={blog.wrap}>
      <p className={blog.eyebrow}>Ops context</p>
      <h1 className={blog.title}>Ava Context</h1>
      <p className={blog.lead}>Live operational context — refreshed every 60 seconds.</p>
      {ctx ? (
        <pre className={blog.card} style={{ whiteSpace: "pre-wrap", overflowX: "auto", fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.6 }}>
          {renderContext(ctx as Record<string, unknown>)}
        </pre>
      ) : (
        <div className={blog.card} style={{ textAlign: "center", color: "var(--muted)" }}>
          <p style={{ fontSize: "2rem", marginBottom: 12 }}>◈</p>
          <p>Ava is offline — solar night mode.</p>
          <p style={{ fontSize: 13, marginTop: 8 }}>Context will be available after sunrise.</p>
        </div>
      )}
    </section>
  );
}
