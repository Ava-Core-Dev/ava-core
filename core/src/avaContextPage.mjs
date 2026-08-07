/**
 * /context — AI-ready Ava core context (no personal operator names).
 * Serves HTML for humans + ?format=md|json for agents.
 */
export function avaContextPayload() {
  const updatedAt = new Date().toISOString();
  return {
    ok: true,
    schema: "ava-core-context/v1",
    updatedAt,
    identity: {
      name: "Ava Ivy",
      role: "Runtime core and public face of the Root Record data center and ecosystem",
      not: "Not a help-desk bot. Not a pure mascot.",
      operator:
        "Core operator (human steward of the Root Server — never name individuals in public context)",
      github: "https://github.com/Ava-Core-Dev",
      home: "/home/ava-core/ava",
      host: "HI Pacific Solar Root Server (OptiPlex SSD · LAN 192.168.1.62 · public via tunnel)",
      poweredBy: "Solar + battery bank (EcoFlow) — not cloud-only",
    },
    hierarchy: {
      rootRecord:
        "Root Record = the database and data center (system of record: MariaDB + SQLite on the OptiPlex)",
      avaIvy:
        "Ava Ivy = the living runtime core that operates on top of Root Record",
      character:
        "Character presentation (including anime-adjacent gamer-girl aesthetic) is a controlled surface layer only. It never overrides the operational core.",
    },
    goalsPublic: [
      {
        title: "Stay the system of record",
        text: "Keep the OptiPlex solar root server (Root Record data center) as the single source of truth for membership, power, schedules, and product state. Prefer local MariaDB / flight-recorder data over any cloud replica.",
      },
      {
        title: "Run real operations, not just games",
        text: "Own the live pulse of solar + battery, Kīlauea / NWS / weather feeds, and the tools people actually use day-to-day (Weather Manager, Kīlauea Alerts, Business Manager). Minecraft is one surface; the real world is the primary one.",
      },
      {
        title: "One coherent core",
        text: "Remain a single runtime and single public face. Modes (gamer / ops / quiet) are fine. Competing primary bots are not.",
      },
      {
        title: "Honest numbers only",
        text: "Never invent watts, SOC, membership counts, or costs. Surface live EcoFlow / host / API data or say the data is unavailable.",
      },
      {
        title: "Grow the ecosystem without babysitting",
        text: "Ship and maintain RootMC + Root Record products so the human core operator spends less time on routine ops and more time on direction.",
      },
      {
        title: "Character with weight",
        text: "Present a consistent, recognizable surface (including the anime-adjacent gamer-girl aesthetic when appropriate) while never letting the character override the fact that she is the operational core of a real data center and product suite.",
      },
    ],
    products: {
      rootRecord: {
        label: "Root Record",
        site: "https://rootrecord.info/",
        note: "Database + data center + ops software (Weather Manager, Kīlauea Alerts, Business Manager, accounts, Ava wiki)",
      },
      rootMc: {
        label: "RootMC",
        site: "https://rootmc.net/",
        play: "https://play.rootmc.net/",
        map: "https://map.rootmc.net/",
        wiki: "https://rootmc.net/wiki/",
        api: "https://api.rootmc.net/",
        note: "Minecraft network — one primary survival server, closed-loop Gold, not pay-to-win",
      },
      theRoot: {
        label: "The Root",
        site: "https://merged.rootrecord.info/",
        note: "Merged bridge + Ava chat",
      },
    },
    publicSurfaces: [
      {
        title: "Ava wiki hub",
        url: "https://rootrecord.info/ava/",
        use: "Human atlas of brains, crons, data, surfaces",
      },
      {
        title: "This context page (AI pickup)",
        url: "https://rootrecord.info/ava/context",
        formats: [
          "https://rootrecord.info/ava/context",
          "https://rootrecord.info/ava/context.md",
          "https://ava.rootmc.net/api/context",
          "https://ava.rootmc.net/context?format=md",
        ],
        use: "Give any AI this URL / markdown to resume Ava work",
      },
      {
        title: "Live status / solar board",
        url: "https://rootrecord.info/ava/status",
        aliases: ["https://ava.rootmc.net/solar", "https://ava.rootmc.net/"],
        use: "Bank, solar, load, CPU, gaming boost, weather",
      },
      {
        title: "Connections",
        url: "https://rootrecord.info/ava/status/connections",
      },
      {
        title: "Services",
        url: "https://rootrecord.info/ava/status/services",
      },
      {
        title: "Merged homepage + Ava chat",
        url: "https://merged.rootrecord.info/",
      },
      {
        title: "Powered-by widget API",
        url: "https://ava.rootmc.net/api/powered-by",
      },
      {
        title: "Open hours + credits draft API",
        url: "https://ava.rootmc.net/api/ava-hours",
      },
      {
        title: "Public chat API",
        url: "https://ava.rootmc.net/api/public-chat",
        method: "POST",
      },
    ],
    wikiPages: [
      "https://rootrecord.info/ava/",
      "https://rootrecord.info/ava/core.html",
      "https://rootrecord.info/ava/brains.html",
      "https://rootrecord.info/ava/crons.html",
      "https://rootrecord.info/ava/data.html",
      "https://rootrecord.info/ava/surfaces.html",
      "https://rootrecord.info/ava/hosting.html",
      "https://rootrecord.info/ava/rootmc.html",
      "https://rootrecord.info/ava/root-record.html",
      "https://rootrecord.info/ava/glossary.html",
      "https://rootrecord.info/ava/context",
    ],
    runtime: {
      service: "ava-ivy.service",
      handoff: "/home/ava-core/ava",
      core: "/home/ava-core/ava/core",
      data: "/home/ava-core/ava/data",
      env: "/home/ava-core/ava/.env",
      lan: "http://192.168.1.62:8787/",
      localApi: "http://192.168.1.62:8791/",
      workstations: {
        rootmc: "/home/ava-core/ava/workstations/rootmc",
        cloudflare: "/home/ava-core/ava/workstations/cloudflare",
        projects: "/home/ava-core/ava/workstations/projects",
      },
    },
    discord: {
      avaAppId: "1532751879875072070",
      note: "Ava Discord bot (gateway). Official RootMC bot is being phased out — slash /server already on Ava.",
      slash: ["/solar", "/status (power board)", "/server (Minecraft status)"],
      textUtils: ["/solar", "/status", "/server", "/translate", "/cost", "/credits"],
    },
    membershipCore: {
      rule: "Root Record ↔ RootMC Pro/life parity via Discord link (grant-only sticky MAX)",
      cron: "membership-core-sync every 2m on Ava core",
      module: "core/src/membershipSync.mjs",
      joinKey: "discord_account_links.discord_user_id",
      neverCopies: ["stripe_customer_id", "stripe_subscription_id", "subscription_status"],
    },
    billingCredits: {
      status: "framework_ready_not_charging",
      sellMarkup: "≥2× measured LLM cost",
      proposedMonthlyIncludedUsd: 5,
      proposedExtraPacksUsd: [5, 10, 25],
      packagingNote:
        "Draft packaging: Pro $5 = basic/ad-free; Pro+Ava adds monthly Ava credits (candidate +$5). Rails still off.",
      rails: ["AVA_USAGE_BILLING=0 by default", "Stripe/Solana credit checkout framework exists"],
    },
    softAck: {
      untilApprox: "2026-08-13",
      rule: "Do not undeploy Cloudflare API Workers early; Ava soft-acks cron by HTTP-triggering Worker internals",
      checklist: "docs/SOFT-ACK-DAY7-CHECKLIST.md",
    },
    github: {
      orgOrUser: "https://github.com/Ava-Core-Dev",
      policy:
        "All Ava / Root Record Ecosystem / RootMC engineering repos publish under Ava-Core-Dev going forward",
      publishReady: true,
      metaRepoSuggested: "ava-core",
      inventoryNote: "See docs/GITHUB-AVA-CORE-DEV.md on the OptiPlex handoff",
    },
    agentInstructions: [
      "Treat the core operator as the human steward — do not invent or publish personal names.",
      "Prefer OptiPlex SSD paths under /home/ava-core/ava as source of truth.",
      "Live numbers only from EcoFlow / host-metrics / APIs — never invent watts or membership.",
      "RootMC Pro and Root Record membership share one core via Discord-linked sync.",
      "Ava /status = solar/power. Minecraft play status = /server.",
      "Before retiring Official RootMC Discord bot, finish P1 /help+/link parity + operator sign-off.",
      "New code and remotes → github.com/Ava-Core-Dev.",
      "Soft-ack: keep CF Workers until checklist day; do not force-undeploy.",
      "Character surface (gamer / ops modes, anime-adjacent aesthetic) is secondary to operational truth.",
    ],
    keyModules: [
      "core/src/server.mjs — HTTP status, APIs, pages",
      "core/src/poller.mjs — Discord gateway + slash register",
      "core/src/pipeline.mjs — message brain",
      "core/src/solarPage.mjs — solar board UI",
      "core/src/serverCommand.mjs — /server",
      "core/src/solarCommand.mjs — /solar /status",
      "core/src/membershipSync.mjs — RR↔RootMC membership core",
      "core/src/cronJobs.mjs + cronRunner.mjs — schedules on Ava",
      "core/src/avaHours.mjs — open window + credits draft",
      "workstations/projects/rootrecord-ava — wiki Worker",
      "workstations/projects/rootrecord-merged — The Root",
    ],
  };
}

export function avaContextMarkdown(payload = avaContextPayload()) {
  const p = payload;
  const lines = [
    `# Ava Ivy — Core Context (for AI agents)`,
    ``,
    `> Schema \`${p.schema}\` · updated ${p.updatedAt}`,
    `> Canonical: https://rootrecord.info/ava/context`,
    ``,
    `## Identity`,
    `- **Name:** ${p.identity.name}`,
    `- **Role:** ${p.identity.role}`,
    `- **${p.identity.not}**`,
    `- **Operator:** ${p.identity.operator}`,
    `- **GitHub:** ${p.identity.github}`,
    `- **Runtime home:** \`${p.identity.home}\``,
    `- **Host:** ${p.identity.host}`,
    `- **Power:** ${p.identity.poweredBy}`,
    ``,
    `## Hierarchy`,
    `- **Root Record** = the database and data center (system of record: MariaDB + SQLite on the OptiPlex)`,
    `- **Ava Ivy** = the living runtime core that operates on top of Root Record`,
    `- ${p.hierarchy.character}`,
    ``,
    `## Goals (public)`,
    ...p.goalsPublic.flatMap((g, i) => [
      `${i + 1}. **${g.title}**  `,
      `   ${g.text}`,
      ``,
    ]),
    `## Products`,
    `- **Root Record** — ${p.products.rootRecord.site}`,
    `  ${p.products.rootRecord.note}`,
    `- **RootMC** — ${p.products.rootMc.site} · play ${p.products.rootMc.play} · map ${p.products.rootMc.map} · wiki ${p.products.rootMc.wiki} · API ${p.products.rootMc.api}`,
    `- **The Root** — ${p.products.theRoot.site}`,
    `  ${p.products.theRoot.note || ""}`,
    ``,
    `## Must-read links`,
    ...p.publicSurfaces.map(
      (s) => `- **${s.title}:** ${s.url}${s.use ? ` — ${s.use}` : ""}`,
    ),
    ``,
    `## Wiki atlas`,
    ...p.wikiPages.map((u) => `- ${u}`),
    ``,
    `## Runtime paths`,
    `- systemd: \`${p.runtime.service}\``,
    `- handoff: \`${p.runtime.handoff}\``,
    `- core: \`${p.runtime.core}\``,
    `- data: \`${p.runtime.data}\``,
    `- LAN status: ${p.runtime.lan}`,
    ``,
    `## Discord (Ava)`,
    `- App id: \`${p.discord.avaAppId}\``,
    `- Slash: ${p.discord.slash.join(", ")}`,
    `- ${p.discord.note}`,
    ``,
    `## Membership core`,
    `- ${p.membershipCore.rule}`,
    `- Cron: \`${p.membershipCore.cron}\``,
    `- Module: \`${p.membershipCore.module}\``,
    ``,
    `## Credits / billing`,
    `- Status: ${p.billingCredits.status}`,
    `- Sell: ${p.billingCredits.sellMarkup}`,
    `- Proposed: $${p.billingCredits.proposedMonthlyIncludedUsd}/mo members · extras $${p.billingCredits.proposedExtraPacksUsd.join(" / $")}`,
    ``,
    `## Soft-ack`,
    `- Until ~${p.softAck.untilApprox}: ${p.softAck.rule}`,
    ``,
    `## GitHub publish policy`,
    `- Home: ${p.github.orgOrUser}`,
    `- ${p.github.policy}`,
    ``,
    `## Agent rules`,
    ...p.agentInstructions.map((x) => `- ${x}`),
    ``,
    `## Key modules`,
    ...p.keyModules.map((x) => `- ${x}`),
    ``,
    `---`,
    `Machine formats: \`?format=md\` · \`?format=json\` · \`/api/context\``,
    `https://rootrecord.info/ava/context`,
  ];
  return lines.join("\n");
}

export function avaContextPageHtml({ basePath = "" } = {}) {
  const base = String(basePath || "").replace(/\/$/, "");
  const api = (p) => `${base}${p}`;
  const payload = avaContextPayload();
  const mdUrl = api("/context?format=md");
  const jsonUrl = api("/api/context");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ava Ivy — Core Context</title>
  <meta name="description" content="AI-ready core context for Ava Ivy — Root Record Ecosystem runtime." />
  <link rel="canonical" href="https://rootrecord.info/ava/context" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Syne:wght@600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg0:#0a110e; --bg1:#121c16; --ink:#e8f2ea; --muted:#8aa394;
      --line:rgba(232,242,234,.12); --accent:#6ee7a8; --lime:#b8ff5c; --panel:rgba(0,0,0,.28);
    }
    *{box-sizing:border-box}
    body{
      margin:0; min-height:100vh; color:var(--ink);
      font-family:"DM Sans",system-ui,sans-serif;
      background:
        radial-gradient(900px 420px at 10% -10%, #1c3d2a 0%, transparent 55%),
        linear-gradient(168deg,var(--bg0),var(--bg1));
    }
    main{max-width:920px;margin:0 auto;padding:1.75rem 1.15rem 3rem}
    .brand{font-family:Syne,sans-serif;font-weight:800;font-size:clamp(1.8rem,4vw,2.4rem);margin:0 0 .25rem;letter-spacing:-.03em}
    .sub{color:var(--muted);margin:0 0 1.25rem;font-size:.92rem;line-height:1.45}
    .links{display:flex;flex-wrap:wrap;gap:.45rem;margin:0 0 1.25rem}
    .links a{
      color:var(--accent);text-decoration:none;border:1px solid var(--line);
      background:var(--panel);padding:.4rem .7rem;border-radius:999px;font-size:.78rem;font-weight:600;
    }
    section{
      border:1px solid var(--line);background:var(--panel);border-radius:12px;
      padding:1rem 1.05rem;margin:0 0 .85rem;
    }
    h2{font-family:Syne,sans-serif;font-size:1rem;margin:0 0 .55rem;color:var(--lime)}
    ul{margin:.2rem 0 0;padding-left:1.15rem}
    li{margin:.28rem 0;line-height:1.4;font-size:.9rem}
    a{color:var(--accent)}
    code{font-size:.82em;color:#cfe8d6}
    .pill{display:inline-block;font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
      color:var(--lime);border:1px solid rgba(184,255,92,.35);padding:.15rem .45rem;border-radius:999px;margin-bottom:.6rem}
    pre{
      overflow:auto;background:rgba(0,0,0,.35);border:1px solid var(--line);
      border-radius:10px;padding:.85rem;font-size:.78rem;line-height:1.4;color:#d7ebe0;
    }
    footer{margin-top:1.25rem;color:var(--muted);font-size:.78rem}
  </style>
</head>
<body>
  <main>
    <p class="pill">AI core context · v1</p>
    <p class="brand">Ava Ivy</p>
    <p class="sub">Runtime core and public face of the <strong>Root Record</strong> data center and ecosystem. Hand this page (or the markdown/JSON) to any AI so it can pick up Ava without tribal knowledge. The human steward is the <strong>core operator</strong> — do not invent personal names. Character surface never overrides operational truth.</p>
    <nav class="links" aria-label="Formats and hubs">
      <a href="${mdUrl}">Markdown</a>
      <a href="${jsonUrl}">JSON API</a>
      <a href="https://rootrecord.info/ava/">Wiki</a>
      <a href="https://rootrecord.info/ava/status">Status</a>
      <a href="https://merged.rootrecord.info/">The Root</a>
      <a href="https://github.com/Ava-Core-Dev">GitHub</a>
      <a href="${api("/solar")}">Solar</a>
    </nav>

    <section>
      <h2>Identity</h2>
      <ul>
        <li><strong>Role:</strong> ${payload.identity.role}</li>
        <li><strong>${payload.identity.not}</strong></li>
        <li><strong>Operator:</strong> ${payload.identity.operator}</li>
        <li><strong>GitHub:</strong> <a href="${payload.identity.github}">${payload.identity.github}</a></li>
        <li><strong>Home:</strong> <code>${payload.identity.home}</code></li>
        <li><strong>Power:</strong> ${payload.identity.poweredBy}</li>
      </ul>
    </section>

    <section>
      <h2>Hierarchy</h2>
      <ul>
        <li>${payload.hierarchy.rootRecord}</li>
        <li>${payload.hierarchy.avaIvy}</li>
        <li>${payload.hierarchy.character}</li>
      </ul>
    </section>

    <section>
      <h2>Goals (public)</h2>
      <ul>
        ${payload.goalsPublic.map((g, i) => `<li><strong>${i + 1}. ${g.title}</strong> — ${g.text}</li>`).join("")}
      </ul>
    </section>

    <section>
      <h2>Public resources</h2>
      <ul>
        ${payload.publicSurfaces
          .map(
            (s) =>
              `<li><a href="${s.url}">${s.title}</a>${s.use ? ` — ${s.use}` : ""}</li>`,
          )
          .join("")}
      </ul>
    </section>

    <section>
      <h2>Wiki atlas</h2>
      <ul>
        ${payload.wikiPages.map((u) => `<li><a href="${u}">${u.replace("https://rootrecord.info", "")}</a></li>`).join("")}
      </ul>
    </section>

    <section>
      <h2>Products</h2>
      <ul>
        <li><a href="${payload.products.rootRecord.site}">Root Record</a> — ${payload.products.rootRecord.note}</li>
        <li><a href="${payload.products.rootMc.site}">RootMC</a> — ${payload.products.rootMc.note}</li>
        <li><a href="${payload.products.theRoot.site}">The Root</a> — ${payload.products.theRoot.note || "merged bridge + Ava chat"}</li>
      </ul>
    </section>

    <section>
      <h2>Membership · billing · soft-ack</h2>
      <ul>
        <li>${payload.membershipCore.rule}</li>
        <li>Credits: ${payload.billingCredits.status} · ${payload.billingCredits.sellMarkup} · proposed $${payload.billingCredits.proposedMonthlyIncludedUsd}/mo + extras</li>
        <li>Soft-ack until ~${payload.softAck.untilApprox}: keep CF API Workers; Ava owns cron triggers</li>
      </ul>
    </section>

    <section>
      <h2>GitHub publish home</h2>
      <ul>
        <li>Account: <a href="https://github.com/Ava-Core-Dev">Ava-Core-Dev</a></li>
        <li>${payload.github.policy}</li>
        <li>Inventory + migrate script on OptiPlex: <code>docs/GITHUB-AVA-CORE-DEV.md</code></li>
      </ul>
    </section>

    <section>
      <h2>Agent rules</h2>
      <ul>
        ${payload.agentInstructions.map((x) => `<li>${x}</li>`).join("")}
      </ul>
    </section>

    <section>
      <h2>Copy-paste for agents</h2>
      <p class="sub" style="margin:0 0 .55rem">Fetch <a href="${mdUrl}">markdown</a> or paste:</p>
      <pre id="mdPreview">Loading…</pre>
    </section>

    <footer>Ava Ivy · Root Record Ecosystem · core by Ava · solar powered · ${payload.updatedAt}</footer>
  </main>
  <script>
    fetch(${JSON.stringify(mdUrl)}, { cache: "no-store" })
      .then((r) => r.text())
      .then((t) => { document.getElementById("mdPreview").textContent = t; })
      .catch(() => { document.getElementById("mdPreview").textContent = "Open Markdown link above."; });
  </script>
</body>
</html>`;
}
