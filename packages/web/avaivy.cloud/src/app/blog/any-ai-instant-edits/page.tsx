export const metadata = {
  title: "Any-AI Instant Edits | Ava Ivy",
  description: "How Ava Ivy Cloud turns an AI-generated change into a repeatable local build and deployment operation.",
};

export default function AnyAIInstantEditsPage() {
  return (
    <main style={{maxWidth: 900, margin: "0 auto", padding: "48px 24px", lineHeight: 1.75}}>
      <header>
        <p>AVA IVY CLOUD · DEVELOPMENT</p>
        <h1>Any-AI Instant Edits</h1>
        <h2>Separating AI creativity from trusted deployment operations</h2>
        <p>
          Ava Ivy Cloud is being developed with a simple operational idea: an AI should be
          able to prepare a change without being trusted with the entire deployment process.
        </p>
        <blockquote>
          <strong>Any capable AI can prepare the edit. Ava's local infrastructure performs the operation.</strong>
        </blockquote>
      </header>

      <section>
        <h2>The Problem</h2>
        <p>
          Different AI systems have different strengths. One may be better at interface work,
          another at architecture, another at debugging, and another at writing documentation.
          A project should not need a completely different deployment procedure every time the
          AI helping with the change changes.
        </p>
        <p>
          Ava therefore separates <strong>creating an edit</strong> from
          <strong> executing the edit</strong>.
        </p>
      </section>

      <section>
        <h2>The Handoff Package</h2>
        <p>A requested change is returned as a compact key-file package:</p>
        <pre>{`ava-key-files/
├── Template-key-files/
│   └── HANDOFF.md
└── edits/
    └── avaivy-cloud-editXXX.py`}</pre>
        <p>
          The template explains what the change is supposed to do. The Python edit script is
          the executable operation that applies the source change and runs the established
          local deployment pipeline.
        </p>
      </section>

      <section>
        <h2>What the Local Edit Operation Does</h2>
        <ol>
          <li>Locates the real Ava Ivy Cloud project.</li>
          <li>Backs up an existing target file when appropriate.</li>
          <li>Writes or updates the requested source.</li>
          <li>Runs <code>npm run build</code>.</li>
          <li>Stops if the build fails.</li>
          <li>Collects prerendered HTML from <code>.next/server/app</code>.</li>
          <li>Collects current client assets from <code>.next/static</code>.</li>
          <li>Synchronizes <code>public/</code> assets.</li>
          <li>Preserves existing non-Next static files.</li>
          <li>Creates directory-style route artifacts.</li>
          <li>Atomically replaces the deployment artifact.</li>
          <li>Deploys the finished artifact to the configured Cloudflare Pages production branch.</li>
        </ol>
      </section>

      <section>
        <h2>The Important Separation</h2>
        <pre>{`ANY AI
  │
  ├── understands requested change
  ├── prepares source update
  └── returns complete handoff package
            │
            ▼
      LOCAL EDIT SCRIPT
            │
            ├── backup
            ├── patch
            ├── build
            ├── validate
            ├── rebuild artifact
            └── deploy
            │
            ▼
       AVA IVY CLOUD`}</pre>
        <p>
          The AI can change. The local operational procedure remains stable.
        </p>
      </section>

      <section>
        <h2>Why This Matters</h2>
        <p>
          The method makes Ava's development process portable between AI systems while keeping
          build and deployment logic under a repeatable local operation. An AI does not need to
          remember every previous command sequence to make a site change. The handoff defines
          the change, while the local script executes the known-safe workflow.
        </p>
        <p>
          This also creates a useful audit boundary. The requested change exists as source and
          an executable edit. The build either succeeds or fails. The deployment artifact is
          rebuilt from the current build output rather than being manually assembled in a browser
          or copied through an ad hoc process.
        </p>
      </section>

      <section>
        <h2>Ava's Version of an Instant Edit</h2>
        <blockquote>
          <strong>Request → AI handoff → local executable edit → build → artifact reconstruction → deployment → live verification.</strong>
        </blockquote>
        <p>
          The goal is not to make deployment magical. The goal is to make it reproducible.
        </p>
      </section>

      <section>
        <h2>Related Ava Ivy Sources</h2>
        <ul>
          <li><a href="/roadmap">Ava Roadmap</a> — persistent infrastructure, modular compute, and energy-aware operations.</li>
          <li><a href="/context">Ava Context</a> — project context and operating environment.</li>
          <li><a href="/directory">Directory</a> — available project and ecosystem resources.</li>
          <li><a href="/blog/lead-dev">Lead Development</a> — development direction and responsibility.</li>
          <li><a href="/blog/monorepo-export">Monorepo Export</a> — project structure and export history.</li>
          <li><a href="/blog/desk-runtime">Desk Runtime</a> — Ava's local runtime environment.</li>
          <li><a href="/blog/this-blog">This Blog</a> — the purpose of the Ava Ivy publishing system.</li>
        </ul>
      </section>

      <section>
        <h2>The Principle</h2>
        <blockquote>
          <strong>AI creativity is interchangeable. Ava's operational pipeline is not.</strong>
        </blockquote>
        <p>
          That distinction allows the project to use different AI systems for development while
          preserving a consistent path from a requested change to a tested build and a deployed page.
        </p>
      </section>
    </main>
  );
}
