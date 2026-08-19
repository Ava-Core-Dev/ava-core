export const revalidate = 60;

async function getContext() {
  try {
    const r = await fetch(
      `${process.env.AVA_ORIGIN_URL || "https://ava-origin.rootmc.net"}/api/context`,
      { next: { revalidate: 60 }, signal: AbortSignal.timeout(5000) }
    );
    if (r.ok) return r.json();
  } catch {}
  return null;
}

export default async function ContextPage() {
  const ctx = await getContext();

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "60px 24px" }}>
      <a href="/" style={{ fontSize: 13, color: "var(--muted)", display: "block", marginBottom: 32 }}>
        ← Back
      </a>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, marginBottom: 8 }}>Ava Context</h1>
      <p style={{ color: "var(--muted)", marginBottom: 40, fontSize: 14 }}>
        Live operational context — refreshed every 60 seconds.
      </p>
      {ctx ? (
        <pre style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 24,
          fontSize: 13,
          lineHeight: 1.6,
          overflowX: "auto",
          whiteSpace: "pre-wrap",
          fontFamily: "var(--font-mono)",
        }}>
          {typeof ctx.content === "string" ? ctx.content : JSON.stringify(ctx, null, 2)}
        </pre>
      ) : (
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 40,
          textAlign: "center",
          color: "var(--muted)",
        }}>
          <p style={{ fontSize: "2rem", marginBottom: 12 }}>◈</p>
          <p>Ava is offline — solar night mode.</p>
          <p style={{ fontSize: 13, marginTop: 8 }}>Context will be available after sunrise.</p>
        </div>
      )}
    </main>
  );
}
