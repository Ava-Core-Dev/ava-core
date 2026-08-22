export const revalidate = 60;

export default function AvaContextPage() {
  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "56px 24px 96px" }}>
      <div className="eyebrow">OPS CONTEXT</div>
      <h1>Ava Context</h1>
      <p className="lede">
        Live operational context for Ava Ivy and the Root Record runtime. This page is a
        working reference, not a frozen biography.
      </p>
      <section className="panel">
        <h2>Runtime</h2>
        <p>
          Ava Ivy operates as infrastructure and a public runtime surface inside the Root
          Record ecosystem. Current work is centered on the Ava host and its connected
          services, with public surfaces separated from private implementation details.
        </p>
        <ul>
          <li>Home tree: <code>/home/ava-core/ava</code></li>
          <li>Public context changes as active operations change.</li>
          <li>Production edits are built and validated before deployment.</li>
          <li>RootMC has its own operational boundary and context surface.</li>
        </ul>
      </section>
      <section className="panel">
        <h2>Working boundaries</h2>
        <p>
          Ava is not treated as a single monolithic process. Host operations, web surfaces,
          scheduled work, integrations, and higher-cost AI workloads can be separated and
          measured independently.
        </p>
        <p>
          Always-on services stay small, while heavier compute can remain asleep or be
          requested only when needed.
        </p>
      </section>
      <section className="panel">
        <h2>Related context</h2>
        <p>
          <a href="/context/dev">Developer / agent brain</a>{" · "}
          <a href="/context/rootmc">RootMC context</a>{" · "}
          <a href="/roadmap">Energy and compute roadmap</a>{" · "}
          <a href="/directory">Directory map</a>
        </p>
      </section>
    </main>
  );
}\n