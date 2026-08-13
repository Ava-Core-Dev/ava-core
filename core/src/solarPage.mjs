/** Solar / power / weather / CPU dashboard — served at /solar on Ava status host. */
export function solarPageHtml({ basePath = "" } = {}) {
  const base = String(basePath || "").replace(/\/$/, "");
  const api = (p) => `${base}${p}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${base ? `<base href="${base}/">` : ""}
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ava Ivy — Solar Root Server</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Syne:wght@600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg0: #000d1a; --bg1: #001428; --ink: #ffffff; --muted: #7a92a8;
      --line: rgba(0, 229, 255, 0.16); --accent: #00e5ff; --lime: #5ef0ff;
      --solar: #f0c14a; --load: #7eb8ff; --bank: #00e5ff; --cpu: #e0a84a; --warn: #e25b5b;
      --panel: rgba(0, 13, 26, 0.55); --offline: #ff2a3a; --stale: #ffb020;
      --gold: #ffd54a; --live: #ff2a3a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh;
      font-family: "DM Sans", system-ui, sans-serif; color: var(--ink);
      background:
        radial-gradient(1100px 520px at 8% -8%, #00334d 0%, transparent 55%),
        radial-gradient(800px 420px at 100% 0%, #001a33 0%, transparent 48%),
        linear-gradient(168deg, var(--bg0), var(--bg1));
    }
    main { max-width: 1120px; margin: 0 auto; padding: 1.75rem 1.15rem 3rem; }
    .top { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
    .brand { font-family: Syne, sans-serif; font-weight: 800; font-size: clamp(1.85rem, 4.5vw, 2.55rem); letter-spacing: -0.03em; margin: 0 0 0.2rem; }
    .sub { color: var(--muted); margin: 0; font-size: 0.92rem; }
    .links { display: flex; flex-wrap: wrap; gap: 0.45rem; }
    .links a {
      color: var(--accent); text-decoration: none; border: 1px solid var(--line);
      background: var(--panel); padding: 0.4rem 0.7rem; border-radius: 999px;
      font-size: 0.78rem; font-weight: 600;
    }
    .links a.primary { background: rgba(0, 229, 255, 0.12); border-color: rgba(0, 229, 255, 0.35); }
    .banner {
      display: flex; flex-wrap: wrap; gap: 0.75rem 1.25rem; align-items: center;
      border: 1px solid var(--line); background: var(--panel); border-radius: 12px;
      padding: 0.75rem 0.95rem; margin-bottom: 1rem; font-size: 0.86rem;
    }
    .banner strong { font-weight: 700; }
    .banner .muted { color: var(--muted); }
    .pill {
      display: inline-flex; align-items: center; gap: 0.35rem;
      padding: 0.2rem 0.55rem; border-radius: 999px; border: 1px solid var(--line);
      font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .pill.ok { color: var(--lime); border-color: rgba(94, 240, 255, 0.4); }
    .pill.warn { color: var(--stale); border-color: rgba(224,168,74,0.4); }
    .pill.bad { color: var(--offline); border-color: rgba(226,91,91,0.45); }
    .kpi strong.lime { color: var(--lime); text-shadow: 0 0 18px rgba(94, 240, 255, 0.28); }
    .kpis { display: grid; grid-template-columns: repeat(7, minmax(0,1fr)); gap: 0.65rem; margin: 0 0 1rem; }
    @media (max-width: 1100px) { .kpis { grid-template-columns: repeat(4, 1fr); } }
    @media (max-width: 720px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
    .kpi {
      border: 1px solid var(--line); background: var(--panel); border-radius: 12px;
      padding: 0.75rem 0.8rem 0.7rem; min-width: 0;
    }
    .kpi label { display: block; color: var(--muted); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.25rem; }
    .kpi strong {
      font-size: 1.18rem; font-weight: 700; font-variant-numeric: tabular-nums;
      display: inline-flex; align-items: baseline; flex-wrap: wrap; gap: 0.15rem 0.4rem;
    }
    .kpi strong .wx-cond {
      font-size: 0.78em; font-weight: 650; color: var(--muted); letter-spacing: 0.01em;
    }
    .kpi .hint { display: block; color: var(--muted); font-size: 0.72rem; margin-top: 0.15rem; line-height: 1.35; }
    .kpi-bar {
      height: 3px; margin-top: 0.55rem; border-radius: 99px;
      background: rgba(0, 229, 255, 0.12); overflow: hidden;
    }
    .kpi-bar > i { display: block; height: 100%; width: 0; background: var(--accent); border-radius: 99px; }
    .about-ava {
      border: 1px solid var(--line); background: var(--panel); border-radius: 12px;
      padding: 0.9rem 1rem; margin: 0 0 1rem;
    }
    .about-ava h2 {
      font-family: Syne, sans-serif; font-size: 0.95rem; margin: 0 0 0.4rem; font-weight: 700;
      color: var(--lime); text-shadow: 0 0 18px rgba(94, 240, 255, 0.22);
    }
    .about-ava p { margin: 0; color: var(--text); font-size: 0.86rem; line-height: 1.45; max-width: 62rem; }
    .about-ava p + p { margin-top: 0.45rem; color: var(--muted); font-size: 0.8rem; }
    .stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem; margin-bottom: 1rem; }
    @media (max-width: 900px) { .stat-grid { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 520px) { .stat-grid { grid-template-columns: 1fr; } }
    .stat {
      border: 1px solid var(--line); background: var(--panel); border-radius: 12px; padding: 0.85rem;
    }
    .stat h3 { font-family: Syne, sans-serif; font-size: 0.88rem; margin: 0 0 0.55rem; font-weight: 700; }
    .stat dl { margin: 0; display: grid; gap: 0.28rem; }
    .stat dt, .stat dd { margin: 0; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
    .stat dt { color: var(--muted); float: left; clear: left; }
    .stat dd { text-align: right; font-weight: 600; }
    .chart-nav {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.55rem 0.75rem;
      border: 1px solid var(--line); background: var(--panel); border-radius: 12px;
      padding: 0.7rem 0.85rem; margin: 0 0 0.75rem;
    }
    .chart-nav label.day-lab {
      display: inline-flex; align-items: center; gap: 0.4rem;
      color: var(--muted); font-size: 0.72rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    .chart-nav input[type="date"] {
      background: rgba(0,0,0,0.35); color: var(--ink); border: 1px solid var(--line);
      border-radius: 8px; padding: 0.35rem 0.5rem; font-family: inherit; font-size: 0.82rem;
      font-variant-numeric: tabular-nums;
    }
    .span-btns, .nav-btns { display: inline-flex; flex-wrap: wrap; gap: 0.35rem; }
    .chart-nav button {
      appearance: none; cursor: pointer; font-family: inherit; font-weight: 700;
      font-size: 0.74rem; letter-spacing: 0.03em; color: var(--muted);
      background: rgba(0,0,0,0.28); border: 1px solid var(--line);
      border-radius: 999px; padding: 0.38rem 0.7rem;
    }
    .chart-nav button:hover { color: var(--ink); border-color: rgba(0, 229, 255,0.4); }
    .chart-nav button.on {
      color: var(--lime); border-color: rgba(94, 240, 255, 0.45);
      background: rgba(0, 229, 255,0.12);
    }
    .chart-nav button:disabled { opacity: 0.4; cursor: default; }
    .chart-nav .range-label { color: var(--muted); font-size: 0.75rem; margin-left: auto; font-variant-numeric: tabular-nums; }
    .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 0.9rem; margin-bottom: 1.1rem; }
    @media (max-width: 760px) { .charts { grid-template-columns: 1fr; } }
    .chart { border: 1px solid var(--line); background: var(--panel); border-radius: 12px; padding: 0.85rem 0.85rem 0.55rem; }
    .chart h2 { font-family: Syne, sans-serif; font-size: 0.92rem; margin: 0 0 0.35rem; font-weight: 700; }
    .chart .meta { color: var(--muted); font-size: 0.72rem; margin: 0 0 0.45rem; }
    svg.plot { width: 100%; height: 180px; display: block; }
    .legend { display: flex; flex-wrap: wrap; gap: 0.65rem; margin-top: 0.35rem; font-size: 0.72rem; color: var(--muted); }
    .legend i { display: inline-block; width: 0.65rem; height: 0.65rem; border-radius: 2px; margin-right: 0.3rem; vertical-align: -1px; }
    .legend i.lime { box-shadow: 0 0 8px rgba(94, 240, 255,0.55); }
    .grid2 { display: grid; grid-template-columns: 1.25fr 0.75fr; gap: 0.9rem; }
    @media (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } }
    .panel { border-top: 1px solid var(--line); padding-top: 0.85rem; margin-top: 0.35rem; }
    .panel h2 { font-family: Syne, sans-serif; font-size: 1rem; margin: 0 0 0.65rem; font-weight: 700; }
    .devices { display: grid; gap: 0.45rem; }
    .dev {
      display: grid; grid-template-columns: 1.4fr 0.7fr repeat(4, 0.65fr);
      gap: 0.35rem; align-items: center; padding: 0.55rem 0;
      border-bottom: 1px solid var(--line); font-size: 0.86rem; font-variant-numeric: tabular-nums;
    }
    @media (max-width: 700px) { .dev { grid-template-columns: 1fr 1fr; } }
    .dev .name { font-weight: 700; }
    .dev.offline, .dev.disconnected { background: rgba(226,91,91,0.08); }
    .dev.stale { background: rgba(224,168,74,0.08); }
    .wx { color: var(--ink); line-height: 1.45; font-size: 0.92rem; }
    .wx .muted { color: var(--muted); }
    .hazard { color: var(--warn); margin-top: 0.35rem; }
    footer { margin-top: 1.5rem; color: var(--muted); font-size: 0.78rem; border-top: 1px solid var(--line); padding-top: 0.85rem; }
    footer a { color: var(--accent); }

    .links a.signin {
      background: rgba(0, 229, 255, 0.10);
      border-color: rgba(0, 229, 255, 0.32);
      font-weight: 650;
    }
    .links a.signin:hover { border-color: rgba(0, 229, 255, 0.55); }
    .links details.ops {
      position: relative;
    }
    .links details.ops > summary {
      list-style: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.35rem 0.7rem;
      border-radius: 999px;
      border: 1px solid rgba(138, 163, 148, 0.35);
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 600;
      user-select: none;
    }
    .links details.ops > summary::-webkit-details-marker { display: none; }
    .links details.ops[open] > summary {
      color: var(--ink);
      border-color: rgba(0, 229, 255, 0.4);
    }
    .links details.ops .ops-panel {
      position: absolute;
      right: 0;
      top: calc(100% + 0.35rem);
      z-index: 20;
      min-width: 11rem;
      padding: 0.45rem;
      border-radius: 0.75rem;
      border: 1px solid var(--line);
      background: rgba(12, 20, 16, 0.96);
      box-shadow: 0 12px 40px rgba(0,0,0,0.35);
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .links details.ops .ops-panel a {
      border-radius: 0.55rem;
      justify-content: flex-start;
    }
    .auth-hint {
      margin: 0.35rem 0 0.85rem;
      color: var(--muted);
      font-size: 0.8rem;
      line-height: 1.4;
    }
    .auth-hint a { color: var(--accent); }


    .full-totals {
      border: 1px solid var(--line); background: var(--panel); border-radius: 12px;
      padding: 0.95rem 1rem 1.05rem; margin: 0 0 1.1rem;
    }
    .full-totals h2 {
      font-family: Syne, sans-serif; font-size: 1.05rem; margin: 0 0 0.3rem; font-weight: 700;
      color: var(--lime); text-shadow: 0 0 18px rgba(94, 240, 255, 0.18);
    }
    .full-totals .meta { color: var(--muted); font-size: 0.75rem; margin: 0 0 0.7rem; line-height: 1.4; }
    .full-totals .avg-daily {
      display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 0.65rem;
      margin: 0 0 0.85rem;
    }
    @media (max-width: 720px) { .full-totals .avg-daily { grid-template-columns: 1fr; } }
    .full-totals .avg-daily .cell {
      border-top: 1px solid var(--line); padding: 0.55rem 0 0.15rem;
    }
    .full-totals .avg-daily label {
      display: block; color: var(--muted); font-size: 0.66rem; text-transform: uppercase;
      letter-spacing: 0.07em; margin-bottom: 0.2rem;
    }
    .full-totals .avg-daily strong {
      font-size: 1.05rem; font-weight: 700; font-variant-numeric: tabular-nums;
    }
    .day-complete {
      border: 1px solid var(--line); background: var(--panel); border-radius: 12px;
      padding: 0.95rem 1rem 1.05rem; margin: 0 0 1rem;
    }
    .day-complete h2 {
      font-family: Syne, sans-serif; font-size: 1.05rem; margin: 0 0 0.25rem; font-weight: 700;
      color: var(--solar);
    }
    .day-complete .meta { color: var(--muted); font-size: 0.75rem; margin: 0 0 0.7rem; line-height: 1.4; }
    .day-complete .pct-row {
      display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between;
      gap: 0.5rem 1rem; margin-bottom: 0.55rem;
    }
    .day-complete .pct {
      font-family: Syne, sans-serif; font-size: clamp(2rem, 6vw, 2.75rem); font-weight: 800;
      font-variant-numeric: tabular-nums; letter-spacing: -0.03em;
      color: var(--lime); text-shadow: 0 0 22px rgba(94, 240, 255, 0.28);
    }
    .day-complete .pct.over { color: #fff59a; }
    .day-complete .compare { color: var(--muted); font-size: 0.86rem; line-height: 1.4; max-width: 28rem; }
    .day-complete .bar {
      height: 0.55rem; border-radius: 999px; background: rgba(255,255,255,0.06);
      overflow: hidden; margin: 0.35rem 0 0.65rem;
    }
    .day-complete .bar > i {
      display: block; height: 100%; border-radius: inherit;
      background: linear-gradient(90deg, var(--solar), var(--lime));
    }
    .day-complete .bar.over > i { background: linear-gradient(90deg, var(--lime), #fff59a); }
    .day-complete .grid {
      display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 0.65rem;
    }
    @media (max-width: 720px) { .day-complete .grid { grid-template-columns: 1fr; } }
    .day-complete .grid label {
      display: block; color: var(--muted); font-size: 0.66rem; text-transform: uppercase;
      letter-spacing: 0.07em; margin-bottom: 0.2rem;
    }
    .day-complete .grid strong {
      font-size: 1.02rem; font-weight: 700; font-variant-numeric: tabular-nums;
    }
    .shutdown-timer {
      border: 1px solid var(--line); background: var(--panel); border-radius: 12px;
      padding: 0.95rem 1rem 1.05rem; margin: 0 0 1rem;
    }
    .day-start-timer {
      border: 1px solid var(--line); background: var(--panel); border-radius: 12px;
      padding: 0.95rem 1rem 1.05rem; margin: 0 0 1rem;
    }
    .day-start-timer h2,
    .shutdown-timer h2 {
      font-family: Syne, sans-serif; font-size: 1.05rem; margin: 0 0 0.25rem; font-weight: 700;
      color: var(--solar);
    }
    .shutdown-head {
      display: flex; flex-wrap: wrap; gap: 0.85rem 1.5rem;
      align-items: flex-end; justify-content: space-between;
    }
    .day-start-timer .countdown,
    .shutdown-timer .countdown {
      font-family: Syne, sans-serif; font-size: clamp(1.8rem, 5vw, 2.4rem); font-weight: 800;
      font-variant-numeric: tabular-nums; letter-spacing: -0.03em; color: var(--lime);
      text-shadow: 0 0 22px rgba(94, 240, 255, 0.22);
    }
    .day-start-timer .meta,
    .shutdown-timer .meta { color: var(--muted); font-size: 0.75rem; margin: 0.35rem 0 0; line-height: 1.4; max-width: 28rem; }
    .shutdown-form { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: flex-end; }
    .shutdown-form label {
      display: flex; flex-direction: column; gap: 0.25rem;
      color: var(--muted); font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.07em;
    }
    .shutdown-form input[type="time"] {
      background: rgba(0,0,0,0.35); color: var(--ink); border: 1px solid var(--line);
      border-radius: 8px; padding: 0.45rem 0.55rem; font: inherit; color-scheme: dark;
    }
    .shutdown-form button {
      background: rgba(94, 240, 255,0.12); color: var(--ink);
      border: 1px solid rgba(94, 240, 255,0.35); border-radius: 8px;
      padding: 0.5rem 0.9rem; font: inherit; font-weight: 600; cursor: pointer;
    }
    .shutdown-form button:hover { background: rgba(94, 240, 255, 0.22); }
    .shutdown-msg { margin: 0.5rem 0 0; font-size: 0.78rem; color: var(--muted); min-height: 1.1em; }
    .shutdown-msg.err { color: #fca5a5; }
    .shutdown-msg.ok { color: var(--lime); }
    .totals-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    table.totals {
      width: 100%; border-collapse: collapse; min-width: 720px;
      font-size: 0.78rem; font-variant-numeric: tabular-nums;
    }
    table.totals th, table.totals td {
      border-bottom: 1px solid var(--line); padding: 0.42rem 0.45rem; text-align: right;
    }
    table.totals th:first-child, table.totals td:first-child { text-align: left; color: var(--muted); }
    table.totals thead th {
      color: var(--muted); font-size: 0.68rem; text-transform: uppercase;
      letter-spacing: 0.06em; font-weight: 700;
    }
    table.totals tbody td { font-weight: 600; color: var(--ink); }
    table.totals tr.section td {
      padding-top: 0.7rem; color: var(--accent); font-weight: 700; font-size: 0.72rem;
      text-transform: uppercase; letter-spacing: 0.05em; border-bottom-color: rgba(0, 229, 255,0.25);
    }
    table.totals .partial { color: var(--stale); font-weight: 600; }

    .empty { color: var(--muted); font-size: 0.85rem; padding: 1.5rem 0; text-align: center; }
  </style>
</head>
<body>
  <main>
    <div class="top">
      <div>
        <p class="brand">Ava Ivy</p>
        <p class="sub" id="siteLabel">HI Pacific Solar Root Server · live tracking</p>
      </div>
            <nav class="links" aria-label="Ava control panel">
        <a href="https://rootrecord.info/ava/" rel="noopener">Wiki</a>
        <a href="${api("/connections")}">Connections</a>
        <a href="${api("/logs")}">Logs</a>
        <a href="${api("/minecraft")}">Minecraft</a>
        <a href="${api("/economy")}">Economy</a>
        <a href="${api("/finance")}">Finance</a>
        <a href="${api("/goals")}">Goals</a>
        <a href="https://ava.rootmc.net/publicfiles/">Files</a>
        <a href="${api("/history")}">History</a>
        <a href="${api("/api/solar")}">API</a>
        <a href="${api("/services")}">Services</a>
      </nav>
    </div>

    <div class="banner" id="banner"></div>
    <div class="kpis" id="kpis"></div>

    <section class="day-complete" id="dayComplete" aria-label="Current Solar Day Completion">
      <h2>Current Solar Day Completion</h2>
      <p class="meta" id="dayCompleteMeta">Today’s production vs average closed days (can exceed 100%).</p>
      <div class="pct-row">
        <div class="pct" id="dayCompletePct">—</div>
        <div class="compare" id="dayCompleteCompare">Gathering today’s watt-minutes…</div>
      </div>
      <div class="bar" id="dayCompleteBar"><i id="dayCompleteFill" style="width:0%"></i></div>
      <div class="grid" id="dayCompleteGrid"></div>
    </section>

    <section class="day-start-timer" id="dayStartTimer" aria-label="Projected daytime start">
      <div class="shutdown-head">
        <div>
          <h2>Projected start</h2>
          <div class="countdown" id="dayStartAvg">—</div>
          <p class="meta" id="dayStartMeta">Follows average first daytime start · change in Ava Desktop Settings.</p>
        </div>
        <div>
          <h2>Night mode</h2>
          <div class="countdown" id="nightCountdown">—</div>
          <p class="meta" id="nightMeta">Return ETA = average daytime start + 1 hour (not sunrise).</p>
        </div>
      </div>
    </section>

    <section class="shutdown-timer" id="shutdownTimer" aria-label="Projected shutdown countdown">
      <div class="shutdown-head">
        <div>
          <h2>Projected shutdown</h2>
          <div class="countdown" id="shutdownCountdown">—</div>
          <p class="meta" id="shutdownMeta">At this time: shutdown report → Minecraft stop → Ava power off. Edit in Desktop Settings.</p>
        </div>
      </div>
    </section>

    <section class="about-ava" id="aboutAva" aria-label="What is Ava Ivy">
      <h2>What is Ava Ivy?</h2>
      <p><strong>Ava Ivy</strong> is the off-grid processor on this solar Root Server — database work, storage, automated tasks, hosting, and data analytics under one roof.</p>
      <p>A custom central AI runs the board: she keeps MariaDB mirrors current, schedules crons and releases, serves live boards and public files, and turns telemetry into decisions you can act on. Less babysitting, more continuous processing from Hawaii Pacific power.</p>
    </section>
    <div class="stat-grid" id="stats"></div>

    <section class="full-totals" id="fullTotals" aria-label="Full Totals and Averages">
      <h2>Full Totals and Averages</h2>
      <p class="meta" id="totalsMeta">Loading window totals from live minute buckets…</p>
      <div class="avg-daily" id="avgDaily"></div>
      <div class="totals-scroll">
        <table class="totals" id="totalsTable">
          <thead></thead>
          <tbody></tbody>
        </table>
      </div>
    </section>

    <div class="chart-nav" id="chartNav" aria-label="Graph time range">
      <label class="day-lab">Day <input type="date" id="chartDay" /></label>
      <div class="span-btns" role="group" aria-label="Time span">
        <button type="button" data-span="1h">1h</button>
        <button type="button" data-span="8h">8h</button>
        <button type="button" data-span="24h">24h</button>
        <button type="button" data-span="7d">7d</button>
        <button type="button" data-span="30d">Month</button>
      </div>
      <div class="nav-btns">
        <button type="button" id="chartPrev">‹ Prev</button>
        <button type="button" id="chartNext">Next ›</button>
      </div>
      <span class="range-label" id="chartRangeLabel">8 hours · live</span>
    </div>

    <div class="charts">
      <section class="chart">
        <h2>Site solar intake</h2>
        <p class="meta" id="solarMeta">watts · on-circuit only</p>
        <div id="chartSolar"></div>
        <div class="legend">
          <span><i style="background:var(--solar)"></i>Solar W</span>
          <span><i class="lime" style="background:var(--lime)"></i>Now</span>
        </div>
      </section>
      <section class="chart">
        <h2>Battery bank</h2>
        <p class="meta">SOC % · on-circuit average</p>
        <div id="chartBank"></div>
        <div class="legend">
          <span><i class="lime" style="background:var(--bank)"></i>Battery %</span>
          <span><i class="lime" style="background:var(--lime)"></i>Now</span>
        </div>
      </section>
      <section class="chart">
        <h2>Load vs charge</h2>
        <p class="meta">site out W · solar in W</p>
        <div id="chartLoad"></div>
        <div class="legend">
          <span><i style="background:var(--load)"></i>Out (load)</span>
          <span><i style="background:var(--solar)"></i>Solar in</span>
          <span><i class="lime" style="background:var(--lime)"></i>Now</span>
        </div>
      </section>
      <section class="chart">
        <h2>Host CPU</h2>
        <p class="meta" id="cpuMeta">workstation sampler</p>
        <div id="chartCpu"></div>
        <div class="legend">
          <span><i style="background:var(--cpu)"></i>CPU %</span>
          <span><i style="background:#9ad0ff"></i>RAM %</span>
        </div>
      </section>
    </div>

    <div class="grid2">
      <section class="panel">
        <h2>EcoFlow devices</h2>
        <div class="devices" id="devices"></div>
      </section>
      <section class="panel">
        <h2>Weather · sun · NWS</h2>
        <div class="wx" id="weather"></div>
        <div style="margin-top:1rem">
          <h2 style="margin-bottom:0.4rem">Array</h2>
          <div class="wx" id="array"></div>
        </div>
      </section>
    </div>

    <footer>
      Live numbers only — EcoFlow minute buckets + host-metrics + NWS (no invented Wh/averages).
      <strong>If this page / <a href="https://ava.rootmc.net/solar">ava.rootmc.net/solar</a> does not connect, the Root Server is offline.</strong>
      · Control panel: <a href="https://ava.rootmc.net/solar">Ava board</a>
      · Account: <a href="https://rootrecord.info/account">Sign in</a>
      · Wiki: <a href="https://rootrecord.info/ava/">rootrecord.info/ava</a>
      · Game: <a href="https://rootmc.net">rootmc.net</a>
      · <span id="age">…</span>
    </footer>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    function esc(s) {
      return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    }
    function fmt(n, suffix = "") {
      if (n == null || Number.isNaN(Number(n))) return "—";
      const x = Number(n);
      const t = Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10;
      return t + suffix;
    }
    function wxCondition(short) {
      const raw = String(short || "").replace(/\s+/g, " ").trim();
      if (!raw) return "";
      const s = raw.toLowerCase();
      if (/thunder|t-?storm|lightning/.test(s)) return "Storm";
      if (/blizzard|snow|sleet|flurries|\bice\b|freez/.test(s)) return "Snow";
      if (/rain|shower|drizzle|sprinkle/.test(s)) return "Rain";
      if (/fog|mist|haze|smoke/.test(s)) return "Fog";
      if (/overcast/.test(s)) return "Overcast";
      if (/mostly cloudy|considerable cloud/.test(s)) return "Cloudy";
      if (/partly cloudy|partly sunny|mostly sunny/.test(s)) return "Partly cloudy";
      if (/\bcloudy\b/.test(s)) return "Cloudy";
      if (/\bclear\b/.test(s)) return "Clear";
      if (/\bsunny\b|\bfair\b/.test(s)) return "Sunny";
      if (/\bwind/.test(s)) return "Windy";
      const words = raw.split(" ").slice(0, 3).join(" ");
      return words.length > 22 ? words.slice(0, 20).trim() : words;
    }
    function fmtKwhFromWh(wh) {
      if (wh == null || Number.isNaN(Number(wh))) return "—";
      const k = Number(wh) / 1000;
      if (Math.abs(k) < 0.01) return Math.round(Number(wh)) + " Wh";
      return Math.round(k * 1000) / 1000 + " kWh est.";
    }
    function fmtTime(t, span) {
      try {
        const d = new Date(t);
        const long = span === "7d" || span === "30d" || span === "day" || span === "24h";
        return d.toLocaleString([], {
          timeZone: "Pacific/Honolulu",
          month: long ? "short" : undefined,
          day: long ? "numeric" : undefined,
          hour: "2-digit",
          minute: "2-digit",
        });
      } catch { return ""; }
    }
    function fmtRange(start, end, span) {
      try {
        const a = new Date(start), b = new Date(end);
        const opts = {
          timeZone: "Pacific/Honolulu",
          month: "short",
          day: "numeric",
          hour: span === "7d" || span === "30d" ? undefined : "2-digit",
          minute: span === "7d" || span === "30d" ? undefined : "2-digit",
        };
        if (span === "30d") {
          return a.toLocaleString([], { timeZone: "Pacific/Honolulu", month: "short", day: "numeric" }) +
            " – " + b.toLocaleString([], { timeZone: "Pacific/Honolulu", month: "short", day: "numeric" });
        }
        return a.toLocaleString([], opts) + " – " + b.toLocaleString([], opts) + " HST";
      } catch { return ""; }
    }
    function todayHst() {
      const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Honolulu", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
      const g = (t) => p.find((x) => x.type === t)?.value;
      return g("year") + "-" + g("month") + "-" + g("day");
    }
    function shiftDay(day, delta) {
      const ms = Date.parse(day + "T12:00:00-10:00");
      if (!Number.isFinite(ms)) return day;
      const d = new Date(ms + delta * 86400_000);
      const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Honolulu", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
      const g = (t) => p.find((x) => x.type === t)?.value;
      return g("year") + "-" + g("month") + "-" + g("day");
    }
    const SPAN_MS = { "1h": 3600_000, "8h": 8*3600_000, "24h": 24*3600_000, "7d": 7*24*3600_000, "30d": 30*24*3600_000 };
    const chartState = { span: "8h", end: null, day: "" };
    function readHash() {
      try {
        const h = String(location.hash || "").replace(/^#/, "");
        if (!h) return;
        const q = new URLSearchParams(h);
        const span = q.get("span");
        if (span && (SPAN_MS[span] || span === "day")) chartState.span = span;
        const day = q.get("day");
        if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) { chartState.day = day; chartState.span = "day"; }
        const end = Number(q.get("end"));
        if (Number.isFinite(end) && end > 0) chartState.end = end;
      } catch { /* ignore */ }
    }
    function writeHash() {
      const q = new URLSearchParams();
      q.set("span", chartState.span);
      if (chartState.span === "day" && chartState.day) q.set("day", chartState.day);
      else if (chartState.end) q.set("end", String(chartState.end));
      const next = "#" + q.toString();
      if (location.hash !== next) history.replaceState(null, "", next);
    }
    function syncNav(d) {
      const span = (d && d.series && d.series.span) || chartState.span;
      document.querySelectorAll(".span-btns button").forEach((btn) => {
        btn.classList.toggle("on", btn.getAttribute("data-span") === span);
      });
      const dayEl = $("chartDay");
      if (dayEl) {
        const today = todayHst();
        dayEl.max = today;
        dayEl.value = (d && d.series && d.series.day) || chartState.day || today;
      }
      const live = !d || d.series?.live !== false;
      const next = $("chartNext");
      if (next) next.disabled = live;
      const label = $("chartRangeLabel");
      if (label && d?.series) {
        label.textContent = (d.series.label || span) + " · " +
          (d.series.live ? "live" : fmtRange(d.series.start, d.series.end, span));
      }
    }
    function fmtSun(iso) {
      if (!iso) return "—";
      try {
        return new Date(iso).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Pacific/Honolulu",
        });
      } catch { return String(iso).slice(11, 16); }
    }
    function fmtWhen(isoOrMs) {
      if (isoOrMs == null) return "—";
      try {
        const d = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(isoOrMs);
        return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      } catch { return "—"; }
    }
    function pathFrom(values, w, h, pad, yMax, yMin = 0) {
      const n = values.length;
      const span = Math.max(1e-6, yMax - yMin);
      let d = "", started = false;
      for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null || !Number.isFinite(Number(v))) { started = false; continue; }
        const x = pad + (n <= 1 ? 0 : (i / (n - 1)) * (w - pad * 2));
        const y = h - pad - ((Number(v) - yMin) / span) * (h - pad * 2);
        d += (started ? " L " : "M ") + x.toFixed(1) + " " + y.toFixed(1);
        started = true;
      }
      return d;
    }
    /** Carry last good sample across short null gaps so chart lines don't shatter. */
    function bridgeGaps(values, maxGap = 12) {
      const out = values.slice();
      let last = null, gap = 0;
      for (let i = 0; i < out.length; i++) {
        const v = out[i];
        if (v != null && Number.isFinite(Number(v))) {
          last = Number(v); gap = 0;
        } else if (last != null && gap < maxGap) {
          out[i] = last; gap++;
        } else {
          gap++;
        }
      }
      return out;
    }
    /** Area fill per continuous run — never close one polygon across overnight gaps (broken triangles). */
    function areaSegments(values, w, h, pad, yMax, yMin = 0) {
      const n = values.length;
      const span = Math.max(1e-6, yMax - yMin);
      const yBase = h - pad;
      const paths = [];
      let seg = [];
      const flush = () => {
        if (seg.length < 2) { seg = []; return; }
        let d = "";
        for (let i = 0; i < seg.length; i++) {
          d += (i ? " L " : "M ") + seg[i].x.toFixed(1) + " " + seg[i].y.toFixed(1);
        }
        const x0 = seg[0].x, x1 = seg[seg.length - 1].x;
        d += " L " + x1.toFixed(1) + " " + yBase + " L " + x0.toFixed(1) + " " + yBase + " Z";
        paths.push(d);
        seg = [];
      };
      for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null || !Number.isFinite(Number(v))) { flush(); continue; }
        const x = pad + (n <= 1 ? 0 : (i / (n - 1)) * (w - pad * 2));
        const y = h - pad - ((Number(v) - yMin) / span) * (h - pad * 2);
        seg.push({ x, y });
      }
      flush();
      return paths;
    }
    function lastPoint(values, w, h, pad, yMax, yMin = 0) {
      const n = values.length;
      const span = Math.max(1e-6, yMax - yMin);
      for (let i = n - 1; i >= 0; i--) {
        const v = values[i];
        if (v == null || !Number.isFinite(Number(v))) continue;
        return {
          x: pad + (n <= 1 ? 0 : (i / (n - 1)) * (w - pad * 2)),
          y: h - pad - ((Number(v) - yMin) / span) * (h - pad * 2),
          v: Number(v),
        };
      }
      return null;
    }
    function drawChart(el, seriesList, opts = {}) {
      const w = 560, h = 180, pad = 18;
      const bridged = seriesList.map((s) => ({
        ...s,
        values: opts.bridge === false ? s.values : bridgeGaps(s.values, opts.maxGap || 12),
      }));
      const all = bridged.flatMap((s) => s.values.filter((v) => v != null));
      let yMax = opts.yMax != null ? opts.yMax : Math.max(...all, 1);
      let yMin = opts.yMin != null ? opts.yMin : 0;
      if (opts.padMax) yMax = yMax * 1.08;
      if (!all.length) { el.innerHTML = '<p class="empty">No samples in this window yet</p>'; return; }
      const grid = [0.25,0.5,0.75].map((f) => {
        const y = pad + f * (h - pad * 2);
        return '<line x1="'+pad+'" x2="'+(w-pad)+'" y1="'+y+'" y2="'+y+'" stroke="rgba(94, 240, 255,0.08)" />';
      }).join("");
      const layers = bridged.map((s) => {
        const fills = s.fill ? areaSegments(s.values, w, h, pad, yMax, yMin) : [];
        const line = pathFrom(s.values, w, h, pad, yMax, yMin);
        const fillHtml = fills.map((fd) => {
          const lime = s.lime
            ? '<path d="'+fd+'" fill="#5ef0ff" fill-opacity="0.10" stroke="none" />'
            : "";
          return lime +
            '<path d="'+fd+'" fill="'+s.color+'" fill-opacity="'+(s.lime ? '0.16' : '0.18')+'" stroke="none" />';
        }).join("");
        return fillHtml +
          '<path d="'+line+'" fill="none" stroke="'+s.color+'" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />';
      }).join("");
      const dots = bridged.map((s) => {
        const p = lastPoint(s.values, w, h, pad, yMax, yMin);
        if (!p) return "";
        const c = s.lime ? "#5ef0ff" : (s.dot || s.color);
        return '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="5.5" fill="'+c+'" fill-opacity="0.22" />' +
          '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="3.1" fill="'+c+'" stroke="#000d1a" stroke-width="1.2" />';
      }).join("");
      const labels = opts.times || [];
      el.innerHTML =
        '<svg class="plot" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" role="img">' +
        grid + layers + dots +
        '<text x="'+pad+'" y="'+(h-4)+'" fill="#7a92a8" font-size="10">'+esc(fmtTime(labels[0], opts.span))+'</text>' +
        '<text x="'+(w-pad)+'" y="'+(h-4)+'" fill="#7a92a8" font-size="10" text-anchor="end">'+esc(fmtTime(labels[labels.length-1], opts.span))+'</text>' +
        '<text x="'+(w-pad)+'" y="'+(pad+2)+'" fill="#5ef0ff" font-size="10" text-anchor="end">'+esc(Math.round(yMax))+(opts.unit||'')+'</text>' +
        '</svg>';
    }
    function row(label, value) {
      return '<div style="display:flex;justify-content:space-between;gap:0.75rem"><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>';
    }
    function moodPillClass(mood) {
      if (mood === "sleepy") return "bad";
      if (mood === "warming_up" || mood === "sweating") return "warn";
      return "ok";
    }
    function statusPill(live, ops) {
      // Host device is the online signal; EcoFlow packs are secondary telemetry.
      if (live.hostOnline === false) {
        return '<span class="pill bad">host offline · Gold tax 10%</span>';
      }
      let html = '<span class="pill ok">host online</span>';
      const mood = (ops && ops.mood) || live.mood;
      const moodLabel = (ops && ops.moodLabel) || live.moodLabel;
      if (moodLabel) html += '<span class="pill '+moodPillClass(mood)+'">'+esc(moodLabel)+'</span>';
      if (live.ecoOffline) html += '<span class="pill warn">EcoFlow offline</span>';
      else if (live.anyDisconnected) html += '<span class="pill warn">EcoFlow pack offline</span>';
      else if (live.ecoStale) html += '<span class="pill warn">EcoFlow stale</span>';
      else html += '<span class="pill ok">EcoFlow live</span>';
      return html;
    }
    function render(d) {
      $("siteLabel").textContent = (d.site?.label || "HI Pacific Solar Root Server") + " · live tracking";
      const live = d.live || {};
      const st = d.stats || {};
      const on = d.online || {};
      const wx = d.weather || {};
      const sun = d.sun || wx.sun || {};
      const period = wx.period || {};

      const mining = d.mining || {};
      const mineOnline = mining.online === true;
      const mineMultNum = mining.multiplier != null
        ? Math.round(Number(mining.multiplier) * 1000) / 1000
        : 1;
      const mineMult = (Number.isInteger(mineMultNum)
        ? mineMultNum.toFixed(1)
        : String(mineMultNum)) + "×";
      const mineTax = Number(mining.tax_rate) > 0 || mining.mode === "tax";
      const cpuHint = mining.cpu_percent != null
        ? "CPU avg " + Math.round(Number(mining.cpu_percent)) + "%"
        : (live.cpuHour != null ? "CPU avg " + Math.round(Number(live.cpuHour)) + "%" : "CPU —");
      const xpHint = mining.xp_multiplier != null && Number(mining.xp_multiplier) > 1
        ? " · skills " + Number(mining.xp_multiplier).toFixed(2) + "×"
        : "";
      const mineHint = mineTax || !mineOnline
        ? "solar offline · 1.00× gold/skills · +1% env tax"
        : "connected · +1% + 1%/10% battery + 1%/100W · battery " + fmt(mining.battery_percent, "%") + " · " + cpuHint + xpHint;

      $("banner").innerHTML =
        statusPill(live, d.ops) +
        (mineTax || !mineOnline
          ? '<span class="pill bad">Solar offline · '+esc(mineMult)+' · +1% env</span>'
          : '<span class="pill ok">Current Gaming Bonus '+esc(mineMult)+'</span>') +
        (mining.xp_multiplier != null && Number(mining.xp_multiplier) > 1
          ? '<span class="pill ok">Skills XP '+esc(Number(mining.xp_multiplier).toFixed(2))+'×</span>'
          : '') +
        '<span><strong>Online since</strong> '+esc(fmtWhen(on.onlineSinceIso || on.onlineSinceMs))+
        ' <span class="muted">('+esc(on.uptimeHuman || "—")+' up)</span></span>' +
        '<span><strong>Sunrise</strong> '+esc(fmtSun(sun.sunrise))+
        ' <span class="muted">· sunset '+esc(fmtSun(sun.sunset))+'</span></span>' +
        (live.ecoAgeMs != null ? '<span class="muted">Eco sample age '+esc(Math.round(live.ecoAgeMs/1000))+'s</span>' : '');

      const wxCond = wxCondition(period.short);
      function tempBothFromF(f) {
        if (f == null || !Number.isFinite(Number(f))) return null;
        const ff = Math.round(Number(f));
        const cc = Math.round((ff - 32) * 5 / 9);
        return ff + "°F / " + cc + "°C";
      }
      function tempBothFromC(c) {
        if (c == null || !Number.isFinite(Number(c))) return null;
        const cc = Math.round(Number(c));
        const ff = Math.round(cc * 9 / 5 + 32);
        return cc + "°C / " + ff + "°F";
      }
      const wxTemp = period.temp != null
        ? (String(period.unit || "F").toUpperCase().startsWith("C")
            ? tempBothFromC(period.temp)
            : tempBothFromF(period.temp))
        : "—";
      const wxValue = wxCond
        ? esc(wxTemp) + '<span class="wx-cond">· ' + esc(wxCond) + "</span>"
        : esc(wxTemp);
      const wxHintBits = [];
      if (period.short && (!wxCond || period.short.toLowerCase() !== wxCond.toLowerCase())) {
        wxHintBits.push(period.short);
      }
      if (period.wind) wxHintBits.push("wind " + period.wind);
      function kpiBar(pct) {
        if (pct == null || !Number.isFinite(Number(pct))) return "";
        const w = Math.max(0, Math.min(100, Number(pct)));
        return '<div class="kpi-bar" aria-hidden="true"><i style="width:'+w+'%"></i></div>';
      }
      const solarPct = live.solarW != null ? Math.min(100, (Number(live.solarW) / 400) * 100) : null;
      const loadPct = live.outW != null ? Math.min(100, (Number(live.outW) / 400) * 100) : null;
      const bonusPct = Number.isFinite(mineMultNum)
        ? Math.max(0, Math.min(100, ((mineMultNum - 1) / 1.1) * 100))
        : null;
      $("kpis").innerHTML = [
        ["Battery now", esc(fmt(live.batteryPct, "%")), "avg day "+fmt(st.bank?.dayAvgPct,"%")+" · roll "+fmt(st.bank?.rollingAvgPct,"%"), true, live.batteryPct],
        ["Current Gaming Bonus", esc(mineMult), mineHint, mineOnline, bonusPct],
        ["Solar input", esc(fmt(live.solarW, " W")), "panel in · morn ~"+fmt(st.solar?.morningAvgW," W")+" · day avg "+fmt(st.solar?.dayAvgW," W"), true, solarPct],
        ["Energy today", esc(fmtKwhFromWh(st.solar?.dayWh)), "est. from minute watts · roll "+fmtKwhFromWh(st.solar?.rollingWh), false, null],
        ["Load out", esc(fmt(live.outW, " W")), "day avg "+fmt(st.load?.dayAvgOutW," W")+" · "+fmtKwhFromWh(st.load?.dayOutWh), false, loadPct],
        ["CPU now", esc(fmt(live.cpu, "%")), (live.cpuTempMaxC != null ? tempBothFromC(live.cpuTempMaxC) : "temp —")+" · 1h "+fmt(st.cpu?.hourAvgPct,"%")+" · day "+fmt(st.cpu?.dayAvgPct,"%"), false, live.cpu],
        ["Weather", wxValue, wxHintBits.join(" · "), false, null],
      ].map(([k,v,h,lime,pct]) =>
        '<div class="kpi"><label>'+esc(k)+'</label><strong'+(lime?' class="lime"':'')+'>'+v+'</strong><span class="hint">'+esc(h)+'</span>'+kpiBar(pct)+'</div>'
      ).join("");

      (function renderDayComplete() {
        const dc = d.dayCompletion || {};
        const nm = d.nightMode || {};
        const pct = dc.completionPct != null ? Number(dc.completionPct) : null;
        const over = pct != null && pct >= 100;
        const frozen = Boolean(
          dc.closed || dc.frozen || dc.overnightMode || nm.nightMode || nm.earlyClose
        );
        const fill = pct == null ? 0 : Math.min(100, Math.max(0, pct));
        const titleEl = document.querySelector("#dayComplete > h2");
        if (titleEl) {
          titleEl.textContent = frozen ? "Solar Day Closed (Final)" : "Current Solar Day Completion";
        }
        const pctEl = $("dayCompletePct");
        pctEl.textContent = pct == null ? "—" : (Math.round(pct * 10) / 10) + "%";
        pctEl.classList.toggle("over", over);
        $("dayCompleteBar").classList.toggle("over", over);
        $("dayCompleteFill").style.width = fill + "%";
        const rem = dc.remainingWh;
        let compare;
        if (frozen) {
          const delta = pct == null ? null : Math.round(Math.abs(pct - 100) * 10) / 10;
          if (pct == null) {
            compare = "Solar day closed — night mode until next sunrise (host still working; projected shutdown is separate).";
          } else if (over) {
            compare = "Final close: " + delta + "% above average. Night mode until sunrise — production no longer counted.";
          } else {
            compare = "Final close: " + delta + "% below average. Night mode until sunrise — production no longer counted.";
          }
        } else if (pct == null || dc.avgBaselineWh == null) {
          compare = "Need a few closed days (or a window average) before completion % locks in. Today is still tracked.";
        } else if (over) {
          compare = "Ahead of the average day — " + fmtKwhFromWh(dc.solarWh) + " produced vs " + fmtKwhFromWh(dc.avgBaselineWh) + " average.";
        } else if (rem != null && rem > 0) {
          compare = fmtKwhFromWh(rem) + " remaining to match the average day (" + fmtKwhFromWh(dc.avgBaselineWh) + ").";
        } else {
          compare = "On pace with the average day.";
        }
        $("dayCompleteCompare").textContent = compare;
        $("dayCompleteMeta").textContent =
          (dc.day || "today") + " HST · " +
          (frozen
            ? (nm.earlyClose ? "CLOSED early (0W) · night until sunrise · " : "FROZEN at sunset · night until sunrise · ")
            : "live daylight · ") +
          "baseline from " +
          (dc.baselineDays != null ? dc.baselineDays + " closed day" + (dc.baselineDays === 1 ? "" : "s") : "—") +
          (dc.baselineSource === "dashboard_window" ? " (window fallback)" : "") +
          " · sunrise→sunset only";
        $("dayCompleteGrid").innerHTML = [
          ["Produced today", fmtKwhFromWh(dc.solarWh ?? st.solar?.dayWh)],
          ["Average day", fmtKwhFromWh(dc.avgBaselineWh)],
          [frozen ? "Final vs average" : "Vs average", pct == null ? "—" : ((Math.round(pct * 10) / 10) + "%")],
        ].map(([k,v]) => '<div><label>'+esc(k)+'</label><strong>'+esc(v)+'</strong></div>').join("");
      })();

      $("stats").innerHTML = [
        ["Solar / energy", [
          ["Current input", fmt(st.solar?.currentW, " W")],
          ["Morning avg", st.solar?.morningAvgW != null ? "~"+fmt(st.solar.morningAvgW," W") : "—"],
          ["Day avg", fmt(st.solar?.dayAvgW, " W")],
          ["Rolling avg", fmt(st.solar?.rollingAvgW, " W")],
          ["Morning note", st.solar?.morningNote || "—"],
          ["Energy today", fmtKwhFromWh(st.solar?.dayWh)],
          ["Energy rolling", fmtKwhFromWh(st.solar?.rollingWh)],
          ["Load today", fmtKwhFromWh(st.load?.dayOutWh)],
          ["Note", "Wh/kWh from minute watts — not labeled solar"],
        ]],
        ["Battery / load", [
          ["Battery now", fmt(st.bank?.currentPct, "%")],
          ["Current Gaming Bonus", mineTax || !mineOnline
            ? mineMult + " · +1% env (offline)"
            : mineMult + " · +1% + 1%/10% battery + 1%/100W"],
          ["Battery day avg", fmt(st.bank?.dayAvgPct, "%")],
          ["Battery rolling", fmt(st.bank?.rollingAvgPct, "%")],
          ["Load now", fmt(st.load?.currentOutW, " W")],
          ["Load day avg", fmt(st.load?.dayAvgOutW, " W")],
          ["Mood", (d.ops && d.ops.moodLabel) || live.moodLabel || "-"], ["Battery mood", st.bank?.mood || live.mood || "-"],
        ]],
        ["CPU / host", [
          ["CPU now", fmt(st.cpu?.currentPct, "%")],
          ["CPU temp", live.cpuTempMaxC != null
            ? (tempBothFromC(live.cpuTempMaxC) + (live.cpuTempType ? " · " + live.cpuTempType : ""))
            : "—"],
          ["RAM now", fmt(st.cpu?.currentRamPct, "%")],
          ["CPU 1h avg", fmt(st.cpu?.hourAvgPct, "%")],
          ["CPU day avg", fmt(st.cpu?.dayAvgPct, "%")],
          ["CPU rolling", fmt(st.cpu?.rollingAvgPct, "%")],
          ["CPU all-time", fmt(st.cpu?.allTimeAvgPct, "%")],
          ["Host", live.hostname || live.hostKey || "—"],
        ]],
        ["Uptime / sun", [
          ["Online since", fmtWhen(on.onlineSinceIso || on.onlineSinceMs)],
          ["Uptime", on.uptimeHuman || "—"],
          ["Poller", on.pollerLive ? "live" : "not live"],
          ["Sunrise", fmtSun(sun.sunrise)],
          ["Sunset", fmtSun(sun.sunset)],
          ["Solar noon", fmtSun(sun.transit)],
          ["Civil dawn", fmtSun(sun.civilTwilightBegin)],
        ]],
      ].map(([title, rows]) =>
        '<section class="stat"><h3>'+esc(title)+'</h3><dl>'+rows.map(([a,b]) => row(a,b)).join("")+'</dl></section>'
      ).join("");


      // Full Totals and Averages (hour / 24h / 7d / 1m / all-time)
      (function renderTotals() {
        const tot = d.totals || {};
        const order = tot.order || ["hour", "h24", "d7", "d30", "all"];
        const labels = tot.labels || { hour:"1 hour", h24:"24 hours", d7:"7 days", d30:"1 month", all:"All time" };
        const wins = tot.windows || {};
        const ad = tot.avgDailyProduction || {};
        const morn = tot.morning || {};
        const cell = (w, getter) => {
          const row = wins[w];
          if (!row) return "—";
          const v = getter(row);
          return v == null || v === "" ? "—" : v;
        };
        const fmtMult = (n) => n == null ? "—" : (Math.round(Number(n)*1000)/1000) + "×";
        const fmtHours = (n) => n == null ? "—" : (Number(n).toFixed(Number(n) >= 10 ? 1 : 2) + "h");
        const head = document.querySelector("#totalsTable thead");
        const body = document.querySelector("#totalsTable tbody");
        if (!head || !body) return;
        head.innerHTML = "<tr><th>Metric</th>" + order.map((k) => {
          const partial = wins[k]?.partial ? ' <span class="partial">partial</span>' : "";
          return "<th>" + esc(labels[k] || k) + partial + "</th>";
        }).join("") + "</tr>";
        const section = (title) => '<tr class="section"><td colspan="'+(order.length+1)+'">'+esc(title)+"</td></tr>";
        const line = (label, getter, fmtFn) => {
          const f = fmtFn || ((x) => x == null ? "—" : String(x));
          return "<tr><td>"+esc(label)+"</td>" + order.map((k) => {
            const raw = cell(k, getter);
            const shown = raw === "—" ? "—" : f(raw);
            return "<td>"+esc(shown)+"</td>";
          }).join("") + "</tr>";
        };
        body.innerHTML = [
          section("Solar production"),
          line("Avg input", (w) => w.solar?.avgW, (v) => fmt(v, " W")),
          line("Max input", (w) => w.solar?.maxW, (v) => fmt(v, " W")),
          line("Producing avg", (w) => w.solar?.producingAvgW, (v) => fmt(v, " W")),
          line("Producing minutes", (w) => w.solar?.producingMinutes, (v) => String(v)),
          line("Total energy", (w) => w.solar?.totalWh, (v) => fmtKwhFromWh(v)),
          line("Avg daily production", (w) => w.daily?.avgSolarWh, (v) => fmtKwhFromWh(v)),
          line("Days with solar", (w) => w.daily?.daysWithSolar, (v) => String(v)),
          section("Load / pack"),
          line("Avg load out", (w) => w.load?.avgOutW, (v) => fmt(v, " W")),
          line("Max load out", (w) => w.load?.maxOutW, (v) => fmt(v, " W")),
          line("Total load out", (w) => w.load?.totalOutWh, (v) => fmtKwhFromWh(v)),
          line("Avg daily load", (w) => w.daily?.avgOutWh, (v) => fmtKwhFromWh(v)),
          line("Avg pack in", (w) => w.load?.avgInW, (v) => fmt(v, " W")),
          line("Total pack in", (w) => w.load?.totalInWh, (v) => fmtKwhFromWh(v)),
          line("Net (solar − load)", (w) => w.net?.solarMinusOutWh, (v) => fmtKwhFromWh(v)),
          section("Battery / mining"),
          line("Battery avg", (w) => w.bank?.avgPct, (v) => fmt(v, "%")),
          line("Battery min", (w) => w.bank?.minPct, (v) => fmt(v, "%")),
          line("Battery max", (w) => w.bank?.maxPct, (v) => fmt(v, "%")),
          line("Gaming boost avg", (w) => w.mining?.avgMultiplier, (v) => fmtMult(v)),
          section("Host"),
          line("CPU avg", (w) => w.host?.avgCpuPct, (v) => fmt(v, "%")),
          line("RAM avg", (w) => w.host?.avgRamPct, (v) => fmt(v, "%")),
          line("Solar samples (min)", (w) => w.samples?.solar, (v) => String(v)),
          line("CPU samples (min)", (w) => w.samples?.cpu, (v) => String(v)),
          line("Coverage", (w) => w.availableHours, (v) => fmtHours(v)),
        ].join("");
        $("avgDaily").innerHTML = [
          ["Avg daily solar", fmtKwhFromWh(ad.solarWh), (ad.basisDays ? ad.basisDays + " HST days · " + (labels[ad.basisWindow] || ad.basisWindow || "") : "warming")],
          ["Avg daily load", fmtKwhFromWh(ad.loadOutWh), "out Wh / days with load samples"],
          ["This morning", morn.avgW != null ? "~" + fmt(morn.avgW, " W") : "—", morn.note || ((morn.minutes || 0) + " morning minutes")],
        ].map(([k,v,h]) =>
          '<div class="cell"><label>'+esc(k)+'</label><strong>'+esc(v)+'</strong><div class="meta" style="margin:0.2rem 0 0">'+esc(h)+"</div></div>"
        ).join("");
        const partialKeys = order.filter((k) => wins[k]?.partial).map((k) => labels[k] || k);
        $("totalsMeta").textContent =
          (tot.note || "Live minute buckets only.") +
          (partialKeys.length ? " Partial: " + partialKeys.join(", ") + " (history shorter than window)." : "") +
          " · " + (tot.ecoSamples || 0) + " eco / " + (tot.cpuSamples || 0) + " CPU minutes loaded.";
      })();

      const mins = (d.series && d.series.minutes) || [];
      const times = mins.map((m) => m.t);
      const span = d.series?.span || chartState.span;
      drawChart($("chartSolar"), [{ values: mins.map((m)=>m.solarW), color:"#f0c14a", fill:true, lime:true }], { times, padMax:true, unit:"W", span });
      drawChart($("chartBank"), [{ values: mins.map((m)=>m.bankSoc), color:"#00e5ff", fill:true, lime:true }], { times, yMax:100, unit:"%", span });
      drawChart($("chartLoad"), [
        { values: mins.map((m)=>m.outW), color:"#7eb8ff", fill:false },
        { values: mins.map((m)=>m.solarW), color:"#f0c14a", fill:false, lime:true, dot:"#5ef0ff" },
      ], { times, padMax:true, unit:"W", span });
      drawChart($("chartCpu"), [
        { values: mins.map((m)=>m.cpu), color:"#e0a84a", fill:true },
        { values: mins.map((m)=>m.ram), color:"#9ad0ff", fill:false },
      ], { times, yMax:100, unit:"%", span });

      $("solarMeta").textContent = "solar input watts · on-circuit · "+(d.series?.ecoSamples??0)+" eco / "+(d.series?.label || (d.series?.hours||"?")+"h")+" · energy today "+fmtKwhFromWh(st.solar?.dayWh);
      $("cpuMeta").textContent = (live.hostname || live.hostKey || "workstation")+" · 1h "+fmt(st.cpu?.hourAvgPct,"%")+" · "+(d.series?.cpuSamples??0)+" CPU min";
      syncNav(d);

      const devices = live.devices || [];
      $("devices").innerHTML = devices.length
        ? '<div class="dev" style="color:var(--muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em"><span>Device</span><span>Status</span><span>SOC</span><span>Solar in</span><span>Pack in</span><span>Out</span></div>' +
          devices.map((dev) => {
            const cls = dev.disconnected || dev.status==="offline" ? "offline" : (dev.stale || dev.status==="stale" ? "stale" : "");
            const stLabel = dev.status === "off-circuit" ? "off-circuit" : (dev.status || (dev.ok ? "online" : "offline"));
            return '<div class="dev '+cls+'"><span class="name">'+esc(dev.label)+'</span><span>'+esc(stLabel)+
              (dev.message ? ' · '+esc(dev.message) : '')+'</span><span>'+esc(fmt(dev.soc,"%"))+
              '</span><span>'+esc(fmt(dev.solarW,"W"))+'</span><span>'+esc(fmt(dev.inW,"W"))+
              '</span><span>'+esc(fmt(dev.outW,"W"))+'</span></div>';
          }).join("")
        : '<p class="empty">No EcoFlow snapshot — treating bank as offline</p>';

      let wxHtml = "";
      if (wx.ok && period.name) {
        wxHtml = "<div><strong>"+esc(period.name)+"</strong> · "+esc(period.temp)+esc(period.unit||"F")+
          " · "+esc(period.short||"")+(period.wind ? " · wind "+esc(period.wind) : "")+"</div>" +
          '<div class="muted">Source: '+(esc(wx.source||"NWS"))+' (local point · city private)</div>';
      } else {
        wxHtml = '<div class="muted">Weather unavailable'+(wx.detail ? " · "+esc(wx.detail) : "")+"</div>";
      }
      wxHtml += '<div style="margin-top:0.45rem"><strong>Sunrise</strong> '+esc(fmtSun(sun.sunrise))+
        ' · <strong>sunset</strong> '+esc(fmtSun(sun.sunset))+
        (sun.transit ? ' · noon '+esc(fmtSun(sun.transit)) : "")+"</div>";
      if (wx.alerts && wx.alerts.length) {
        wxHtml += wx.alerts.map((a) =>
          '<div class="hazard"><strong>'+esc(a.event)+'</strong>'+(a.severity?" ("+esc(a.severity)+")":"")+
          (a.headline?" — "+esc(a.headline):"")+"</div>"
        ).join("");
      } else if (wx.ok) {
        wxHtml += '<div class="muted" style="margin-top:0.35rem">Hazards: none active</div>';
      }
      $("weather").innerHTML = wxHtml;
      const arr = d.array || {};
      $("array").innerHTML = "<div><strong>"+esc(arr.panels??"—")+"</strong> panels / <strong>"+esc(arr.circuits??"—")+
        "</strong> circuits / <strong>"+esc(arr.batteries??"—")+"</strong> batteries</div>" +
        (arr.notes ? '<div class="muted" style="margin-top:0.35rem">'+esc(arr.notes)+"</div>" : "");
      $("age").textContent = "refresh just now · "+(d.updatedAt||"").slice(11,19)+"Z";
      applyShutdown(d.projectedShutdown);
      applyDayStart(d.dayStart);
      applyNight(d.nightMode);
    }
    let shutdownAtMs = null;
    let nightUntilMs = null;
    function pad2(n) { return String(n).padStart(2, "0"); }
    function fmtLeft(ms) {
      let s = Math.max(0, Math.floor(ms / 1000));
      const h = Math.floor(s / 3600); s %= 3600;
      const m = Math.floor(s / 60); const sec = s % 60;
      return pad2(h) + ":" + pad2(m) + ":" + pad2(sec);
    }
    function applyDayStart(ds) {
      const avgEl = $("dayStartAvg");
      const meta = $("dayStartMeta");
      if (!avgEl) return;
      if (!ds || !ds.ok) {
        avgEl.textContent = "—";
        return;
      }
      const proj = ds.projected || {};
      avgEl.textContent = proj.label || ds.averageLabel || ds.todayLabel || "—";
      if (meta) {
        const bits = [];
        if (proj.source === "manual") bits.push("manual (Desktop Settings)");
        else if (proj.source === "average") bits.push("auto from average");
        else bits.push("default until average exists");
        if (ds.todayLabel) bits.push("today started " + ds.todayLabel);
        if (ds.averageLabel) bits.push("avg " + ds.averageLabel + (ds.sampleDays != null ? " (" + ds.sampleDays + " days)" : "") + " +1h");
        if (proj.wiggleMinutes) bits.push("display " + (proj.label || "") + " (+" + proj.wiggleMinutes + "m)");
        meta.textContent = bits.join(" · ");
      }
    }
    function applyNight(nm) {
      if (!nm || !nm.ok) return;
      nightUntilMs = nm.nightMode && nm.untilMs ? Number(nm.untilMs) : null;
      const meta = $("nightMeta");
      if (meta) {
        if (nm.nightMode) {
          meta.textContent = (nm.earlyClose ? "Night mode (early 0W close) · return ETA " : "Night mode · return ETA ") +
            (nm.untilLabel || nm.returnEta?.label || "—") +
            " · avg start + 1h (not sunrise) · overnight stats still close at sunrise";
        } else {
          meta.textContent = "Daylight · night mode starts at sunset " +
            (nm.untilKind === "sunset" && nm.untilLabel ? nm.untilLabel : "") +
            " · return window = avg start + 1h";
        }
      }
      paintNight();
    }
    function applyShutdown(ps) {
      if (!ps || !ps.ok) return;
      shutdownAtMs = Number(ps.atMs) || null;
      const meta = $("shutdownMeta");
      if (meta) {
        meta.textContent = "Target " + (ps.label || ps.timeHst || "—") +
          " · report + Minecraft /rootstop + Ava power off · edit in Desktop Settings";
      }
      paintCountdown();
    }
    function paintCountdown() {
      const el = $("shutdownCountdown");
      if (!el) return;
      if (!shutdownAtMs) { el.textContent = "—"; return; }
      el.textContent = fmtLeft(shutdownAtMs - Date.now());
    }
    function paintNight() {
      const el = $("nightCountdown");
      if (!el) return;
      if (!nightUntilMs) {
        el.textContent = "day";
        return;
      }
      el.textContent = fmtLeft(nightUntilMs - Date.now());
    }
    function solarQuery() {
      const q = new URLSearchParams();
      q.set("span", chartState.span);
      if (chartState.span === "day" && chartState.day) q.set("day", chartState.day);
      else if (chartState.end) q.set("end", String(chartState.end));
      else q.set("hours", chartState.span === "1h" ? "1" : chartState.span === "24h" ? "24" : chartState.span === "7d" ? "168" : chartState.span === "30d" ? "720" : "8");
      return q.toString();
    }
    async function tick() {
      try {
        const res = await fetch("${api("/api/solar")}?" + solarQuery(), { cache: "no-store" });
        if (!res.ok) {
          $("banner").innerHTML = '<span class="pill bad">HOST OFFLINE</span> <strong>API HTTP '+res.status+'</strong> <span class="muted">— if ava.rootmc.net/solar does not connect, the Root Server is offline.</span>';
          $("age").textContent = "API HTTP "+res.status+" · host offline signal";
          return;
        }
        const d = await res.json();
        if (d?.ok) render(d);
        else {
          $("banner").innerHTML = '<span class="pill bad">HOST OFFLINE</span> <strong>Solar API error</strong> <span class="muted">— if this page does not connect, the Root Server is offline.</span>';
          $("age").textContent = "API error · host offline signal";
        }
      } catch {
        $("banner").innerHTML = '<span class="pill bad">HOST OFFLINE</span> <strong>Cannot reach solar API</strong> <span class="muted">— if ava.rootmc.net/solar does not connect, the Root Server is offline.</span>';
        $("age").textContent = "HTTP down · Root Server offline";
      }
    }
    readHash();
    document.querySelectorAll(".span-btns button").forEach((btn) => {
      btn.addEventListener("click", () => {
        chartState.span = btn.getAttribute("data-span") || "8h";
        chartState.day = "";
        chartState.end = null;
        writeHash();
        syncNav({ series: { span: chartState.span, live: true, label: btn.textContent, day: todayHst() } });
        tick();
      });
    });
    $("chartDay")?.addEventListener("change", () => {
      const v = String($("chartDay").value || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      chartState.span = "day";
      chartState.day = v;
      chartState.end = null;
      writeHash();
      tick();
    });
    $("chartPrev")?.addEventListener("click", () => {
      if (chartState.span === "day") {
        const cur = chartState.day || todayHst();
        chartState.day = shiftDay(cur, -1);
        chartState.end = null;
      } else {
        const ms = SPAN_MS[chartState.span] || SPAN_MS["8h"];
        const end = chartState.end || Date.now();
        chartState.end = end - ms;
        chartState.day = "";
      }
      writeHash();
      tick();
    });
    $("chartNext")?.addEventListener("click", () => {
      if (chartState.span === "day") {
        const cur = chartState.day || todayHst();
        const next = shiftDay(cur, 1);
        if (next > todayHst()) return;
        chartState.day = next;
        chartState.end = null;
      } else {
        const ms = SPAN_MS[chartState.span] || SPAN_MS["8h"];
        const end = (chartState.end || Date.now()) + ms;
        if (end >= Date.now() - 30_000) chartState.end = null;
        else chartState.end = end;
        chartState.day = "";
      }
      writeHash();
      tick();
    });
    tick();
    setInterval(paintCountdown, 1000);
    setInterval(paintNight, 1000);
    setInterval(() => {
      if (chartState.end || (chartState.span === "day" && chartState.day && chartState.day < todayHst())) return;
      tick();
    }, 15000);
  </script>
    <div id="powered-by-ava" class="powered-by-ava" data-powered-by-ava="1"></div>
    <script src="https://rootrecord.info/ava/assets/powered-by-ava.js" defer></script>
</body>
</html>`;
}
