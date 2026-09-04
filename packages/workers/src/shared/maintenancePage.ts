/**
 * Public offline / origin-down landing page.
 * Canonical HTML: apps/core/static/maintenance.html
 * Regenerate with: python windows/sync_maintenance_html.py
 * Do not show CF 1033, HOST OFFLINE, goals, donate wallets, Snapdragon, or 1 TB copy.
 */
import type { UptimeFacts } from "./uptime";

/** Null block baked into the canonical HTML, replaced when we have real numbers. */
const UPTIME_PLACEHOLDER = '{"last_up_ms":null,"avg_recovery_s":null,"outages":0}';

export function maintenanceHtml(facts?: UptimeFacts | null): string {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <title>RootRecord — We’ll be back</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      font-family: Georgia, "Iowan Old Style", "Segoe UI", serif;
      color: #f4efe6;
      background: #0a1016;
      line-height: 1.55;
    }
    main {
      max-width: 40rem;
      margin: 0 auto;
      padding: 3.5rem 1.25rem 4.5rem;
    }
    .brand {
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-size: 0.72rem;
      font-weight: 700;
      font-family: "Segoe UI", system-ui, sans-serif;
      color: #ff6a2a;
      text-decoration: none;
    }
    h1 {
      font-weight: 500;
      font-size: clamp(1.85rem, 5vw, 2.6rem);
      line-height: 1.15;
      letter-spacing: -0.03em;
      margin: 1.4rem 0 0.85rem;
    }
    h2 {
      font-family: "Segoe UI", system-ui, sans-serif;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #7d8a96;
      margin: 2.1rem 0 0.7rem;
    }
    p { margin: 0 0 1rem; color: #c5ced6; }
    .lede { font-size: 1.05rem; color: #e4ddd2; }
    .card {
      border: 1px solid #1c2a36;
      background: #0d151c;
      border-radius: 0.7rem;
      padding: 1rem 1.05rem 0.85rem;
      margin: 0 0 0.75rem;
    }
    .card h3 {
      font-family: "Segoe UI", system-ui, sans-serif;
      font-size: 0.95rem;
      font-weight: 650;
      margin: 0 0 0.35rem;
      color: #f4efe6;
    }
    .card p { margin: 0; font-size: 0.95rem; }
    .up h3 { color: #3ee0c6; }
    .held h3 { color: #d4a574; }
    .pills {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin: 0.85rem 0 0;
    }
    .pills span {
      font-family: "Segoe UI", system-ui, sans-serif;
      font-size: 0.75rem;
      letter-spacing: 0.02em;
      border: 1px solid #2a3d4c;
      color: #c5ced6;
      border-radius: 999px;
      padding: 0.22rem 0.65rem;
    }
    .links { display: flex; flex-wrap: wrap; gap: 0.85rem 1.2rem; margin-top: 1.7rem; }
    a { color: #3ee0c6; }
    .seen { margin: 1.5rem 0 0; }
    .seen h3 { color: #d4a574; }
    .seen .big {
      font-family: "Segoe UI", system-ui, sans-serif;
      font-variant-numeric: tabular-nums;
      font-size: 1.35rem;
      font-weight: 650;
      color: #f4efe6;
      margin: 0.35rem 0 0.2rem;
      letter-spacing: -0.01em;
    }
    .clock { color: #7d8a96; font-size: 0.85rem; font-family: "Segoe UI", system-ui, sans-serif; margin-top: 2rem; }
  </style>
</head>
<body>
  <main>
    <a class="brand" href="https://rootrecord.cloud">RootRecord</a>
    <h1>The desk is dark right now.</h1>
    <p class="lede">This page is the public door. The HI Pacific Solar Root Server is on. Minecraft is still up.</p>

    <div class="card seen">
      <h3 id="seenWhen">Last known time is not recorded yet.</h3>
      <p class="big" id="seenBack">&nbsp;</p>
      <p id="seenNote">This page fills in once the door has watched the desk go dark and come back.</p>
    </div>
    <script id="ava-uptime" type="application/json">{"last_up_ms":null,"avg_recovery_s":null,"outages":0}</script>

    <h2>What happened</h2>
    <p>On Tuesday, August 25, the solar server died. The board failed.</p>
    <p>Work moved to the HI Pacific Solar Root Server on the same island: 16 GB of memory, 512 GB of storage.</p>
    <div class="pills">
      <span>Root Server</span>
      <span>16 GB</span>
      <span>512 GB</span>
      <span>Hawaiʻi</span>
    </div>

    <h2>What's up</h2>
    <div class="card up">
      <h3>RootMC</h3>
      <p>Minecraft is up at play.rootmc.net. The RootMC website is held.</p>
    </div>
    <div class="card held">
      <h3>Kīlauea Alerts</h3>
      <p>Held on the public web. The volcano feed is running on the root server.</p>
    </div>
    <div class="card held">
      <h3>Weather Manager</h3>
      <p>Held on the public web. Weather is running on the root server.</p>
    </div>
    <div class="card held">
      <h3>Business Manager</h3>
      <p>Held on the public web. Money pages stay hidden.</p>
    </div>
    <div class="card held">
      <h3>Sign-in and dashboards</h3>
      <p>Account pages stay off. No public goals. No wallets.</p>
    </div>

    <p>The public web shows this page. Local tools stay on the root server.</p>
    <div class="links">
      <a href="https://play.rootmc.net">play.rootmc.net</a>
      <a href=".">Retry</a>
    </div>
    <p class="clock" id="hst">Hawaiʻi time</p>
  </main>
  <script>
    function tick() {
      const el = document.getElementById("hst");
      if (!el) return;
      const t = new Intl.DateTimeFormat("en-US", {
        timeZone: "Pacific/Honolulu",
        weekday: "short", hour: "numeric", minute: "2-digit", hour12: true
      }).format(new Date());
      el.textContent = t + " HST";
    }
    tick();
    setInterval(tick, 15000);

    // Last known time + countdown to the measured average return.
    // Numbers come from the door's own up/down log. Nothing is estimated here.
    var UPTIME = (function () {
      var el = document.getElementById("ava-uptime");
      try { return JSON.parse((el && el.textContent) || "{}") || {}; }
      catch (e) { return {}; }
    })();

    function spanShort(sec) {
      sec = Math.max(0, Math.round(sec));
      var h = Math.floor(sec / 3600);
      var m = Math.floor((sec % 3600) / 60);
      var s = sec % 60;
      if (h > 0) return h + "h " + (m < 10 ? "0" : "") + m + "m";
      if (m > 0) return m + "m " + (s < 10 ? "0" : "") + s + "s";
      return s + "s";
    }

    function spanRough(sec) {
      sec = Math.max(0, Math.round(sec));
      var h = Math.floor(sec / 3600);
      var m = Math.round((sec % 3600) / 60);
      if (h > 0) return m > 0 ? h + "h " + m + "m" : h + " hours";
      if (m > 0) return m + " minutes";
      return sec + " seconds";
    }

    function spanAgo(sec) {
      sec = Math.round(sec);
      if (sec < 90) return sec + " seconds ago";
      var m = Math.round(sec / 60);
      if (m < 90) return m + " minutes ago";
      var h = Math.round(m / 60);
      if (h < 36) return h + " hours ago";
      return Math.round(h / 24) + " days ago";
    }

    function seenTick() {
      var when = document.getElementById("seenWhen");
      var back = document.getElementById("seenBack");
      var note = document.getElementById("seenNote");
      if (!when || !back || !note) return;

      var last = Number(UPTIME.last_up_ms) || 0;
      if (!last) return;

      var stamp = new Intl.DateTimeFormat("en-US", {
        timeZone: "Pacific/Honolulu",
        weekday: "short", hour: "numeric", minute: "2-digit", hour12: true
      }).format(new Date(last));
      var down = (Date.now() - last) / 1000;
      when.textContent = "Last online " + stamp + " HST, " + spanAgo(down) + ".";

      var avg = Number(UPTIME.avg_recovery_s) || 0;
      var runs = Number(UPTIME.outages) || 0;
      var basis = runs === 1 ? "one outage" : runs + " outages";

      if (!avg) {
        back.style.display = "none";
        note.textContent = "No average return time measured yet. It comes back when it works here.";
        return;
      }
      back.style.display = "";
      var left = avg - down;
      if (left > 0) {
        back.textContent = "Back in about " + spanShort(left);
        note.textContent = "It usually returns within " + spanRough(avg) + " of going dark, measured over " + basis + ".";
      } else {
        back.textContent = "Past the usual window";
        note.textContent = "It usually returns within " + spanRough(avg) + " of going dark, measured over " + basis + ". This one is taking longer. It comes back when it works here.";
      }
    }
    seenTick();
    setInterval(seenTick, 1000);
  </script>
</body>
</html>
`;
  if (!facts || !facts.last_up_ms) return html;
  return html.replace(UPTIME_PLACEHOLDER, JSON.stringify(facts));
}

export function maintenancePage(facts?: UptimeFacts | null): Response {
  return new Response(maintenanceHtml(facts), {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "120",
      "X-Ava-Fallback": "maintenance",
    },
  });
}

export function goalsHiddenPage(): Response {
  return new Response(maintenanceHtml(), {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Ava-Goals": "hidden",
    },
  });
}
