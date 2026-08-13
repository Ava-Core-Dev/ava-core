import { avaEcoBarHtml, avaWebChromeCss } from "./avaWebChrome.mjs";

/**
 * Ava-themed 404 / 502 HTML for HTTP origin, Pages, and Worker edges.
 */
export function avaErrorPageHtml(status = 404, { title, lead } = {}) {
  const code = Number(status) === 502 ? 502 : 404;
  const heading = title || (code === 502 ? "Ava is unreachable" : "Page not found");
  const body =
    lead ||
    (code === 502
      ? "The solar Root Server did not answer. Try status, or come back after daytime start."
      : "That URL is not on this host. Head home, or jump to play / status.");
  const css = avaWebChromeCss();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${code} — ${heading}</title>
  <meta name="theme-color" content="#000d1a" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=Syne:wght@700;800&display=swap" rel="stylesheet" />
  <style>
    ${css}
    main.ava-error {
      max-width: 36rem; margin: 12vh auto 4rem; padding: 0 1.25rem;
      font-family: "DM Sans", system-ui, sans-serif;
    }
    main.ava-error .code {
      font-family: Syne, sans-serif; font-weight: 800; font-size: 0.8rem;
      letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent);
      margin: 0 0 0.6rem;
    }
    main.ava-error h1 {
      font-family: Syne, sans-serif; font-weight: 800; letter-spacing: -0.03em;
      font-size: clamp(1.8rem, 5vw, 2.6rem); margin: 0 0 0.55rem;
    }
    main.ava-error p { color: var(--muted); line-height: 1.5; margin: 0 0 1.4rem; }
    main.ava-error .row { display: flex; flex-wrap: wrap; gap: 0.55rem; }
    main.ava-error a.btn {
      display: inline-flex; align-items: center; padding: 0.55rem 0.95rem;
      border-radius: 999px; border: 1px solid var(--line); text-decoration: none;
      font-weight: 650; font-size: 0.88rem; color: var(--ink);
      background: rgba(0, 13, 26, 0.55);
    }
    main.ava-error a.btn.primary {
      background: #00e5ff; color: #000d1a; border-color: #00e5ff;
    }
  </style>
</head>
<body class="ava-branded">
  ${avaEcoBarHtml(code === 502 ? "ava" : "rootrecord")}
  <main class="ava-error">
    <p class="code">${code}</p>
    <h1>${heading}</h1>
    <p>${body}</p>
    <div class="row">
      <a class="btn primary" href="https://rootrecord.info/">RootRecord</a>
      <a class="btn" href="https://rootmc.net/">RootMC</a>
      <a class="btn" href="https://play.rootmc.net">play.rootmc.net</a>
      <a class="btn" href="https://rootrecord.info/ava/status">Ava status</a>
    </div>
  </main>
</body>
</html>`;
}
