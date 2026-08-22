export const revalidate = 300;

export default function AvaDeveloperContextPage() {
  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "56px 24px 96px" }}>
      <div className="eyebrow">DEVELOPER / AGENT BRAIN</div>
      <h1>Ava Developer Context</h1>
      <p className="lede">
        Operational rules for working on Ava: verify the runtime, patch the smallest useful
        surface, build the real project, and deploy only validated artifacts.
      </p>
      <section className="panel">
        <h2>Current operating method</h2>
        <ul>
          <li>Do not invent paths: inspect or search the Ava tree when a location is uncertain.</li>
          <li>Back up every source file before an automated edit overwrites it.</li>
          <li>Run the actual production build after source changes.</li>
          <li>Reconstruct the deploy artifact from the current validated Next output.</li>
          <li>Replace the Pages artifact atomically instead of mixing old and new chunks.</li>
          <li>Keep deployment annotations out of TSX/module code unless they use valid syntax.</li>
        </ul>
      </section>
      <section className="panel">
        <h2>Failure handling</h2>
        <p>
          Compile failures, external fetch failures, and deployment failures are different
          classes of problem. A source edit is not declared successful until build and
          artifact reconstruction complete.
        </p>
      </section>
      <section className="panel">
        <h2>Connected surfaces</h2>
        <p>
          RootMC integrations are documented separately because governance, player-facing
          systems, Discord workflows, and game/runtime code have their own boundary.
        </p>
        <p>
          <a href="/context">Ava context</a>{" · "}
          <a href="/context/rootmc">RootMC context</a>{" · "}
          <a href="/blog/any-ai-instant-edit">Any-AI instant edit method</a>
        </p>
      </section>
    </main>
  );
}\n