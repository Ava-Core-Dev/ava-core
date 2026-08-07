/**
 * Blank Services page — placeholder until content is specified.
 */
export function servicesPageHtml({ basePath = "" } = {}) {
  const base = String(basePath || "").replace(/\/$/, "");
  const api = (p) => `${base}${p.startsWith("/") ? p : `/${p}`}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ava Ivy · Services</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #070a08; --text: #e8f0e6; --muted: #8a9a86; --line: rgba(184,255,92,0.14);
      --panel: rgba(0,0,0,0.28); --lime: #b8ff5c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; color: var(--text);
      font-family: "IBM Plex Sans", system-ui, sans-serif;
      background:
        radial-gradient(900px 420px at 12% -8%, rgba(184,255,92,0.10), transparent 55%),
        radial-gradient(700px 380px at 95% 0%, rgba(240,193,74,0.08), transparent 50%),
        var(--bg);
    }
    main { max-width: 1100px; margin: 0 auto; padding: 1.25rem 1.1rem 2.5rem; }
    .top { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.85rem; align-items: flex-start; margin-bottom: 1.25rem; }
    .brand { font-family: Syne, sans-serif; font-size: clamp(1.7rem, 3.5vw, 2.35rem); font-weight: 800; margin: 0; letter-spacing: -0.03em; }
    .sub { margin: 0.2rem 0 0; color: var(--muted); font-size: 0.88rem; }
    .links { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
    .links a {
      color: var(--lime); text-decoration: none; font-size: 0.78rem; font-weight: 600;
      border: 1px solid rgba(184,255,92,0.28); border-radius: 999px; padding: 0.35rem 0.75rem;
      background: rgba(0,0,0,0.22);
    }
    .links a:hover { border-color: rgba(184,255,92,0.55); }
    .blank {
      border: 1px solid var(--line); background: var(--panel); border-radius: 12px;
      min-height: 52vh; padding: 1.25rem;
    }
  </style>
</head>
<body>
  <main>
    <div class="top">
      <div>
        <p class="brand">Ava Ivy</p>
        <p class="sub">Services</p>
      </div>
      <nav class="links" aria-label="Ava control panel">
        <a href="https://rootrecord.info/ava/" rel="noopener">Wiki</a>
        <a href="${api("/connections")}">Connections</a>
        <a href="${api("/api/solar")}">API</a>
        <a href="${api("/services")}">Services</a>
      </nav>
    </div>
    <section class="blank" aria-label="Services"></section>
  </main>
</body>
</html>`;
}
