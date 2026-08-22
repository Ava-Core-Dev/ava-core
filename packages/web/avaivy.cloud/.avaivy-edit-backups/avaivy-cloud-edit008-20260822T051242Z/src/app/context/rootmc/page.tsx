export const revalidate = 300;

export default function RootMCContextPage() {
  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "56px 24px 96px" }}>
      <div className="eyebrow">ROOTMC · OPS CONTEXT</div>
      <h1>RootMC Context</h1>
      <p className="lede">
        Operational context for the RootMC surface as it connects to Ava Ivy, governance,
        player services, Discord, and the Root Record runtime.
      </p>
      <section className="panel">
        <h2>Surface split</h2>
        <p>
          RootMC is a distinct public/game ecosystem. Discord is used for player help and
          data/cloud-facing interaction. Deep runtime and code work belongs in the actual
          integration tree rather than being inferred from a public chat surface.
        </p>
      </section>
      <section className="panel">
        <h2>Governance boundary</h2>
        <p>
          RootMC governance uses weighted Council mechanics rather than a simple
          one-player-equals-one-vote model. Linked-account state, proposals, polls, and
          weighted results are runtime concerns and should not be replaced with hard-coded
          UI assumptions.
        </p>
      </section>
      <section className="panel">
        <h2>Discovered integration paths</h2>
        <p>The currently discovered runtime candidates are:</p>
        <ul>
          <li><code>/home/ava-core/ava/all-connections/rootmc/discord-slack-poller/src/gateway.mjs</code></li>
          <li><code>/home/ava-core/ava/all-connections/rootmc/discord-slack-poller/src/governanceClient.mjs</code></li>
        </ul>
        <p>
          Additional copies exist in mirrors and workstation trees. Their presence alone does
          not make them canonical; active runtime ownership should be verified before editing.
        </p>
      </section>
      <section className="panel">
        <h2>Ava connection</h2>
        <p>
          Ava Ivy provides the infrastructure/runtime side of the broader system. RootMC keeps
          its own player-facing and governance concerns while connecting through explicit
          integration surfaces.
        </p>
        <p>
          <a href="/context">Ava context</a>{" · "}
          <a href="/context/dev">Developer context</a>{" · "}
          <a href="/roadmap">Compute and energy roadmap</a>
        </p>
      </section>
    </main>
  );
}\n