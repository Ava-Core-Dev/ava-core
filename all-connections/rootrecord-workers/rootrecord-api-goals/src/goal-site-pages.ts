/** Same-origin HTML for g.rootrecord.info so login does not depend on a stale Vercel preview. */

const CSS = `
:root { --bg:#0a0e14; --text:#e5e7eb; --muted:#6b7280; --accent:#f59e0b; --cyan:#06b6d4; --border:#1f2937; --surface:#111827; --font: Inter, system-ui, sans-serif; --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
* { box-sizing: border-box; }
html, body { margin:0; background:var(--bg); color:var(--text); font-family:var(--font); }
a { color:var(--cyan); text-decoration:none; }
a:hover { text-decoration:underline; }
.shell { min-height:100dvh; display:flex; flex-direction:column; }
.header { border-bottom:1px solid var(--border); background:rgba(10,14,20,.9); backdrop-filter:blur(12px); position:sticky; top:0; z-index:40; }
.headerInner { max-width:1100px; margin:0 auto; padding:0 24px; height:56px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
.brand { font-weight:700; font-size:16px; letter-spacing:-.02em; color:var(--text); display:flex; align-items:center; gap:8px; }
.brand .mark { color:var(--accent); font-size:18px; }
.brand em { font-style:normal; color:var(--accent); margin-left:8px; font-weight:600; font-size:12px; letter-spacing:.08em; text-transform:uppercase; }
.nav { display:flex; align-items:center; gap:24px; flex-wrap:wrap; }
.nav a, .nav button { color:var(--muted); font-size:13px; background:none; border:0; padding:0; cursor:pointer; font-family:inherit; }
.nav a:hover, .nav button:hover { color:var(--text); text-decoration:none; }
.main { flex:1; max-width:1100px; margin:0 auto; width:100%; padding:36px 24px 80px; }
.hero { margin-bottom:36px; }
.hero h1 { font-size:32px; letter-spacing:-.04em; line-height:1.15; max-width:18ch; }
.hero p { color:var(--muted); margin-top:10px; max-width:52ch; }
.form { display:flex; flex-direction:column; gap:14px; max-width:520px; }
label { display:flex; flex-direction:column; gap:6px; font-size:13px; color:var(--muted); }
input, textarea, select { background:#0a0e14; border:1px solid var(--border); border-radius:10px; color:var(--text); padding:11px 12px; font:inherit; }
textarea { min-height:120px; }
.btn { display:inline-flex; align-items:center; justify-content:center; width:100%; margin-top:4px; padding:11px 14px; border-radius:10px; border:0; font-weight:700; cursor:pointer; font-size:14px; }
.btnGold { background:var(--accent); color:#0a0e14; }
.btnGhost { background:transparent; color:var(--text); border:1px solid var(--border); }
.err { color:#ef4444; font-size:13px; }
.ok { color:#10b981; font-size:13px; }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:16px; }
.poster { display:block; background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow:hidden; color:inherit; text-decoration:none; }
.poster:hover { border-color:#374151; text-decoration:none; transform:translateY(-2px); }
.posterImg { aspect-ratio:1; background:#111827; background-size:cover; background-position:center; }
.posterBody { padding:14px; }
.kicker { font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--accent); margin-bottom:6px; }
.meta { font-size:12px; color:var(--muted); margin-top:8px; }
.meter { height:4px; background:#1f2937; border-radius:99px; margin-top:12px; overflow:hidden; }
.meter > span { display:block; height:100%; background:var(--accent); }
.detail { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:28px; }
@media (max-width:860px) { .detail { grid-template-columns:1fr; } }
.art { border-radius:16px; overflow:hidden; border:1px solid var(--border); aspect-ratio:1; background:#111827; background-size:cover; background-position:center; }
.panel { background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:18px; }
.addr { font-family:var(--mono); font-size:11px; word-break:break-all; background:#0a0e14; border:1px solid var(--border); border-radius:8px; padding:10px; color:var(--cyan); }
.preview { width:160px; height:160px; object-fit:cover; border-radius:12px; border:1px solid var(--border); }
.empty { color:var(--muted); }
.hint { font-size:12px; color:var(--muted); margin:0; }
.moneyArticle { margin-top:22px; padding-top:18px; border-top:1px solid var(--border); max-width:62ch; }
.moneyArticle h2 { font-size:18px; letter-spacing:-.03em; margin:0 0 10px; }
.moneyArticle h3 { font-size:13px; letter-spacing:.08em; text-transform:uppercase; color:var(--accent); margin:18px 0 8px; }
.moneyArticle p, .moneyArticle li { color:var(--muted); font-size:13px; line-height:1.55; margin:0 0 10px; }
.moneyArticle ul { margin:0 0 12px; padding-left:1.15rem; }
.moneyArticle .legal { font-size:12px; color:#9ca3af; background:#0a0e14; border:1px solid var(--border); border-radius:12px; padding:12px 14px; }
.posterBy { display:flex; align-items:center; gap:8px; margin-top:10px; color:var(--muted); font-size:12px; }
.avatar { width:22px; height:22px; border-radius:99px; object-fit:cover; background:#111827; flex-shrink:0; }
.avatarLg { width:72px; height:72px; border-radius:99px; object-fit:cover; background:#111827; border:1px solid var(--border); }
.shot { aspect-ratio:16/10; background:#111827; background-size:cover; background-position:center; }
.previewWide { width:100%; max-width:420px; max-height:240px; object-fit:contain; border-radius:12px; border:1px solid var(--border); background:#0a0e14; }
.row { display:flex; gap:12px; align-items:center; }
.liveBal { margin:4px 0 12px; }
.liveBal b { display:block; font-size:22px; letter-spacing:-.03em; font-weight:800; }
.liveBal span { color:var(--muted); font-size:13px; font-weight:600; }
.qrWrap { display:flex; flex-direction:column; align-items:center; gap:10px; margin:14px 0 8px; }
.qrWrap img { width:168px; height:168px; border-radius:12px; background:#f4f1ea; padding:8px; }
.amtRow { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:end; }
.amtRow .btn { width:auto; margin-top:0; padding:11px 14px; white-space:nowrap; }
.amtRow label { margin:0; }
.cardQr { width:56px; height:56px; border-radius:8px; background:#f4f1ea; padding:4px; float:right; margin:0 0 8px 8px; }
.clusterBanner { background:#1a1408; border-bottom:1px solid #3a2e14; color:#e6c77a; font-size:13px; padding:10px 24px; text-align:center; }
.clusterBanner strong { color:var(--accent); }
.modalScrim { position:fixed; inset:0; z-index:80; background:rgba(4,7,12,.78); backdrop-filter:blur(8px); display:flex; align-items:flex-end; justify-content:center; padding:20px; }
@media (min-width:720px) { .modalScrim { align-items:center; } }
.modalCard { width:min(560px,100%); background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:22px 22px 18px; box-shadow:0 24px 80px rgba(0,0,0,.45); }
.modalCard h2 { font-size:22px; letter-spacing:-.03em; margin:0 0 8px; }
.modalCard p { color:var(--muted); font-size:14px; line-height:1.5; margin:0 0 12px; }
.modalCard ul { margin:0 0 16px; padding-left:1.15rem; color:var(--text); font-size:14px; line-height:1.55; }
.modalCard li { margin:0 0 6px; }
.modalActions { display:flex; flex-direction:column; gap:8px; }
.modalActions .btn { margin-top:0; }
`;

const JS = `
const TOKEN_KEY = "rr_goals_token";
const DEVICE_KEY = "rr_goals_device";
function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) { id = "web-" + crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, id); }
  return id;
}
function readToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
function writeToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => {
    if (c === "&") return "&amp;";
    if (c === "<") return "&lt;";
    if (c === ">") return "&gt;";
    if (c === '"') return "&quot;";
    return "&#39;";
  });
}
function usd(cents) {
  return (Number(cents || 0) / 100).toLocaleString("en-US", { style:"currency", currency:"USD" });
}
function donationLine(d) {
  const src = String(d.source || "");
  const cur = String(d.currency || "").toLowerCase();
  const day = String(d.created_at || "").slice(0, 10);
  if (cur === "sol" || src === "custodial_sol") {
    const sol = Number(d.amount_atomic || 0) / 1e9;
    return sol.toFixed(4) + " SOL · hosted wallet · " + day;
  }
  if (cur === "usdc" || src === "custodial_usdc") {
    return usd(d.amount_cents) + " USDC · hosted wallet · " + day;
  }
  if (cur === "shards" || src === "ava_shards") {
    return Number(d.amount_atomic || d.amount_cents || 0).toLocaleString() + " Ava Shards · " + day;
  }
  return usd(d.amount_cents) + " · " + (src || "card") + " · " + day;
}
function posterBy(p) {
  if (!p || !p.display_name) return "";
  const av = p.avatar_url ? '<img class="avatar" src="' + esc(p.avatar_url) + '" alt=""/>' : "";
  const name = p.slug
    ? '<a href="/u/' + esc(p.slug) + '">Posted by ' + esc(p.display_name) + "</a>"
    : "<span>Posted by " + esc(p.display_name) + "</span>";
  return '<div class="posterBy">' + av + name + "</div>";
}
function moneyProcessArticle(g) {
  const symbol = esc(g.token_symbol || "GOAL");
  const cluster = esc(g.solana_cluster || g.token_cluster || "devnet");
  return '<article class="moneyArticle">' +
    '<h2>How monetary goals work</h2>' +
    '<p class="legal"><strong>Legal disclaimer.</strong> Contributions to Root Goals are voluntary support for a stated project target. They are not an investment contract, equity, debt, security, profit share, or guarantee of any return. Goal tokens track funding progress for that isolated goal only and have no promised cash value. Root Record may change fees, networks, or tooling. Crypto transfers are irreversible once confirmed. Card payments are processed by Stripe; Root Record never stores full card numbers. Do not contribute funds you cannot afford to lose. Nothing here is legal, tax, or financial advice — check local law before donating or holding tokens.</p>' +
    '<h3>Isolated wallet</h3>' +
    '<p>Each monetary goal gets its own custodial Solana address. Deposits for this goal stay on that address until the creator withdraws after the target is met, or refunds close the goal. Ava server goals are posted by Ava’s own Root Record account; community goals stay under the member who posted them.</p>' +
    '<h3>What counts as raised</h3>' +
    '<p>The meter uses landed value after platform fees: <strong>5%</strong> on card donations (Stripe’s processing fee is additional) and <strong>2.5%</strong> on SOL / USDC transfers. Hosted Root-wallet sends and Ava Shards follow the same goal ledger rules. ATA rent and network fees can reduce what remains for refunds.</p>' +
    '<h3>Goal tokens (' + symbol + ')</h3>' +
    '<ul>' +
      '<li>100 goal tokens equal 100% of the USD target for this goal.</li>' +
      '<li>A $1 landed deposit on a $100 goal mints about 1 token after ATA rent; overfunding still mints past 100%.</li>' +
      '<li>Tokens mint to the contributor’s Root wallet on Solana <strong>' + cluster + '</strong> (mainnet when the treasury has ≥ 0.01 SOL, otherwise devnet).</li>' +
      '<li>Token status starts pending until the first successful mint path is ready.</li>' +
    '</ul>' +
    '<h3>Withdrawals &amp; cancel</h3>' +
    '<p>Creators cannot withdraw until the target is met. Canceling refunds what remains after ATA rent and transaction fees. New deposits after a withdraw can still mint tokens. Always verify the QR / address on this page before sending crypto.</p>' +
  '</article>';
}
async function api(path, init = {}) {
  const headers = new Headers(init.headers || {});
  const tok = readToken();
  if (tok && !headers.has("Authorization")) headers.set("Authorization", "Bearer " + tok);
  if (!headers.has("X-Guest-Id")) headers.set("X-Guest-Id", deviceId());
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers, credentials: "include" });
  const json = await res.json().catch(() => ({}));
  const token = String(json.access_token || json.token || "");
  if (token) writeToken(token);
  return { ok: res.ok, status: res.status, json };
}
void (async () => {
  const a = document.getElementById("authNav");
  if (!a) return;
  const me = await api("/v1/me");
  if (!me.ok) return;
  const email = String(me.json.email || "").trim();
  a.textContent = email || "Account";
  a.setAttribute("href", "/goals/new");
  const prof = document.createElement("a");
  prof.href = "/profile";
  prof.textContent = "Profile";
  a.before(prof);
  const galMine = await api("/api/gallery");
  if (galMine.ok && galMine.json.staff) {
    const st = document.createElement("a");
    st.href = "/gallery/reports";
    st.textContent = "Reports";
    a.before(st);
  }
  const out = document.createElement("button");
  out.type = "button";
  out.textContent = "Sign out";
  out.onclick = async () => {
    out.disabled = true;
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
    } catch (_) { /* still clear local session */ }
    writeToken("");
    location.href = "/goals";
  };
  a.after(out);
})();
void (async () => {
  const banner = document.getElementById("clusterBanner");
  if (!banner) return;
  const h = await api("/health");
  if (!h.ok) return;
  const cluster = String(h.json.solana_cluster || "devnet");
  if (cluster === "mainnet-beta" || cluster === "mainnet") {
    if (h.json.cluster_note) banner.innerHTML = String(h.json.cluster_note);
    else banner.hidden = true;
    return;
  }
  banner.innerHTML = String(h.json.cluster_note || banner.textContent || "");
})();
const MAX_IMAGE_BYTES = 380000;
async function fileToImage(file) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file); } catch (_) { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read that image."));
      i.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
function drawSquare(source, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#121a26";
  ctx.fillRect(0, 0, size, size);
  const side = Math.min(source.width, source.height);
  const sx = (source.width - side) / 2;
  const sy = (source.height - side) / 2;
  ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
  return canvas;
}
function dataUrlBytes(dataUrl) {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}
async function resizeGoalImage(file) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("Choose a PNG, JPEG, WebP, or GIF.");
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("Image is over 20MB. Pick a smaller photo.");
  }
  const src = await fileToImage(file);
  try {
    let dataUrl = "";
    const start = Math.min(1024, Math.max(src.width, src.height, 256));
    for (let dim = start; dim >= 256; dim = Math.floor(dim * 0.82)) {
      const canvas = drawSquare(src, dim);
      for (const q of [0.9, 0.82, 0.74, 0.66, 0.58, 0.5]) {
        dataUrl = canvas.toDataURL("image/jpeg", q);
        if (dataUrlBytes(dataUrl) <= MAX_IMAGE_BYTES) return { dataUrl, dim, kb: Math.round(dataUrlBytes(dataUrl) / 1024) };
      }
    }
    throw new Error("Could not compress this image under the size limit.");
  } finally {
    if (typeof src.close === "function") src.close();
  }
}
function drawFit(source, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height, 1));
  const w = Math.max(32, Math.round(source.width * scale));
  const h = Math.max(32, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#080c10";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}
async function resizeShotImage(file) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("Choose a PNG, JPEG, WebP, or GIF.");
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("Image is over 20MB. Pick a smaller screenshot.");
  }
  const src = await fileToImage(file);
  try {
    let dataUrl = "";
    const start = Math.min(1600, Math.max(src.width, src.height, 256));
    for (let dim = start; dim >= 480; dim = Math.floor(dim * 0.82)) {
      const canvas = drawFit(src, dim);
      for (const q of [0.86, 0.76, 0.64, 0.52]) {
        dataUrl = canvas.toDataURL("image/jpeg", q);
        if (dataUrlBytes(dataUrl) <= MAX_IMAGE_BYTES) {
          return { dataUrl, dim, kb: Math.round(dataUrlBytes(dataUrl) / 1024) };
        }
      }
    }
    throw new Error("Could not compress this screenshot under the size limit.");
  } finally {
    if (typeof src.close === "function") src.close();
  }
}
`;

function html(title: string, body: string, extraScript = ""): Response {
  const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <meta name="theme-color" content="#0a0e14"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
  <!-- rr-goals-native -->
  <style>${CSS}</style>
</head>
<body>
  <div class="shell">
    <header class="header"><div class="headerInner">
      <a class="brand" href="/goals"><span class="mark">◈</span> Root Record <em>Goals</em></a>
      <nav class="nav">
        <a href="/goals">Public</a>
        <a href="/shards">Shards</a>
        <a href="/gallery">Gallery</a>
        <a href="/goals/new">Post a goal</a>
        <a href="/memberships">Memberships</a>
        <a href="https://rootrecord.online/blog">Blog</a>
        <a href="/login" id="authNav">Sign in</a>
      </nav>
    </div></header>
    <div class="clusterBanner" id="clusterBanner">Treasury below 0.01 SOL on mainnet issues on <strong>devnet</strong>. SOL, USDC, and goal tokens there are testnet. Card donations are still live USD.</div>
    <main class="main">${body}</main>
  </div>
  <script>
${JS}
${extraScript}
  </script>
</body>
</html>`;
  return new Response(page, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
    },
  });
}

function loginPage(nextPath: string): Response {
  const next = nextPath.startsWith("/") ? nextPath : "/goals/new";
  return html(
    "Sign in — Root Goals",
    `<div class="form" style="margin:0 auto">
      <section class="hero">
        <h1 id="heading">Sign in</h1>
        <p>Email and password for your Root Record account. Anyone can join.</p>
      </section>
      <form id="auth">
        <label>Email <input type="email" name="email" required autocomplete="username"/></label>
        <label>Password <input type="password" name="password" required autocomplete="current-password"/></label>
        <p class="err" id="err" hidden></p>
        <button class="btn btnGold" type="submit" id="go">Sign in</button>
        <button class="btn btnGhost" type="button" id="toggle">Need an account?</button>
      </form>
      <noscript><p class="err">JavaScript is required to sign in.</p></noscript>
    </div>`,
    `
let mode = "login";
const next = ${JSON.stringify(next)};
const heading = document.getElementById("heading");
const go = document.getElementById("go");
const toggle = document.getElementById("toggle");
const err = document.getElementById("err");
toggle.onclick = () => {
  mode = mode === "login" ? "signup" : "login";
  heading.textContent = mode === "signup" ? "Create a Root Record account" : "Sign in";
  go.textContent = mode === "signup" ? "Create account" : "Sign in";
  toggle.textContent = mode === "login" ? "Need an account?" : "Have an account?";
};
document.getElementById("auth").onsubmit = async (e) => {
  e.preventDefault();
  err.hidden = true;
  go.disabled = true;
  go.textContent = "Working…";
  try {
    const fd = new FormData(e.target);
    const path = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
    const res = await api(path, {
      method: "POST",
      body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
    });
    const token = String(res.json.access_token || res.json.token || "");
    if (!res.ok || !token) {
      const detail = String(res.json.detail || "Sign-in failed.");
      err.textContent = detail;
      err.hidden = false;
      return;
    }
    location.href = next;
  } catch (ex) {
    err.textContent = ex instanceof Error ? ex.message : "failed";
    err.hidden = false;
  } finally {
    go.disabled = false;
    go.textContent = mode === "signup" ? "Create account" : "Sign in";
  }
};
void (async () => {
  const me = await api("/v1/me");
  if (me.ok && (me.json.access_token || me.json.token || me.json.email)) location.replace(next);
})();
`,
  );
}

function catalogPage(): Response {
  return html(
    "Public goals — Root Record",
    `<section class="hero">
      <h1>Public goals</h1>
      <p>Members post public goals. Each page shows who posted it. Official Ava goals are marked Ava · server. New SOL, USDC, and goal tokens issue on <strong>mainnet</strong> when the treasury has at least 0.01 SOL — otherwise they fall back to Solana devnet. Card is still real USD.</p>
    </section>
    <div id="list"><p class="empty">Loading…</p></div>`,
    `
function card(g) {
  const raised = Number(g.raised_cents || 0);
  const target = Number(g.estimated_cost_cents || 0);
  const money = g.requires_money !== false && target > 0;
  const pct = money
    ? Math.min(100, Math.round((raised / target) * 100))
    : Math.max(0, Math.min(100, Math.floor(Number(g.percent_complete) || 0)));
  const img = g.image_url ? "style='background-image:url(" + JSON.stringify(g.image_url) + ")'" : "";
  const qr = g.donate_wallet ? "/public/g/" + encodeURIComponent(g.id) + "/qr.svg" : "";
  const meta = money
    ? (esc(usd(raised)) + (target ? " of " + esc(usd(target)) : ""))
    : (pct + "% complete" + (g.target_date_est ? " · est " + esc(g.target_date_est) : ""));
  return '<a class="poster" href="/goals/' + esc(g.id) + '">' +
    '<div class="posterImg" ' + img + '></div>' +
    '<div class="posterBody">' +
    (qr ? '<img class="cardQr" alt="" src="' + esc(qr) + '"/>' : "") +
    '<div class="kicker">' + (g.is_server_goal ? "Ava · server" : "Community") +
      (money ? "" : " · non-monetary") + '</div>' +
    '<h3>' + esc(g.title) + '</h3>' +
    posterBy(g.posted_by) +
    '<div class="meter"><span style="width:' + pct + '%"></span></div>' +
    '<div class="meta">' + meta + '</div>' +
    '<div class="meta" data-live="' + esc(g.id) + '">On-chain…</div>' +
    '</div></a>';
}
void (async () => {
  const res = await api("/public/catalog");
  const goals = Array.isArray(res.json.goals) ? res.json.goals : [];
  const el = document.getElementById("list");
  if (!goals.length) { el.innerHTML = '<p class="empty">No public goals yet. <a href="/goals/new">Post the first one</a>.</p>'; return; }
  el.innerHTML = '<div class="grid">' + goals.map(card).join("") + '</div>';
  for (const node of el.querySelectorAll("[data-live]")) {
    const gid = node.getAttribute("data-live");
    const bres = await api("/public/g/" + encodeURIComponent(gid) + "/balance");
    const b = (bres.ok && bres.json.live_balance) || {};
    node.textContent = Number(b.sol || 0).toFixed(4) + " SOL · " + Number(b.usdc || 0).toFixed(2) + " USDC";
  }
})();
`,
  );
}

function newGoalPage(): Response {
  return html(
    "Post a public goal — Root Record",
    `<section class="hero">
      <h1>Post a public goal</h1>
      <p>Members create a public goal page with artwork. Choose a money goal (USD target + donate wallet) or a non-monetary goal (percent complete + estimated completion date).</p>
    </section>
    <form class="form" id="create">
      <label>Title <input name="title" required maxlength="80"/></label>
      <label>What this is for <textarea name="purpose" required></textarea></label>
      <label>Goal type
        <select name="goal_type" id="goalType">
          <option value="money">Money — raise funds</option>
          <option value="non_money">Non-monetary — track progress</option>
        </select>
      </label>
      <div id="moneyFields">
        <label>Target (USD, optional) <input name="cost" type="number" min="0" step="1" placeholder="2500"/></label>
        <label>Token symbol (optional) <input name="symbol" maxlength="8" placeholder="AVAOPS"/></label>
      </div>
      <div id="progressFields">
        <label>Percent complete <input name="percent" type="number" min="0" max="100" step="1" value="0"/></label>
        <label>Estimated completion date <input name="target_date" type="date"/></label>
      </div>
      <label>Goal image (token artwork) <input name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required/></label>
      <p class="hint">Large photos are auto-cropped square and compressed for the token. GIFs become a still frame.</p>
      <img class="preview" id="preview" hidden alt=""/>
      <p class="ok" id="info" hidden></p>
      <p class="err" id="err" hidden></p>
      <button class="btn btnGold" type="submit" id="go">Create public goal</button>
    </form>
    <div class="modalScrim" id="memberGate" hidden>
      <div class="modalCard" role="dialog" aria-labelledby="gateTitle">
        <h2 id="gateTitle">Members post public goals</h2>
        <p>This page is how Root Record turns a real project into a public goal: title, purpose, artwork, optional USD target, and a token face. Donors send SOL, USDC, or card. Tokens mint on the first deposit. You withdraw only after the target is met — or refund and close before then.</p>
        <ul>
          <li>Artwork becomes the goal token image</li>
          <li>A donate wallet is created with the post</li>
          <li>100 tokens = 100% of the USD target</li>
          <li>Only members can create goals. Anyone can donate.</li>
        </ul>
        <div class="modalActions">
          <a class="btn btnGold" href="/memberships">Get membership to create goals</a>
          <a class="btn btnGhost" href="/goals">Browse public goals</a>
        </div>
      </div>
    </div>`,
    `
const err = document.getElementById("err");
const info = document.getElementById("info");
const go = document.getElementById("go");
const preview = document.getElementById("preview");
const gate = document.getElementById("memberGate");
const goalType = document.getElementById("goalType");
const moneyFields = document.getElementById("moneyFields");
let image = "";
function syncType() {
  const money = goalType.value !== "non_money";
  moneyFields.hidden = !money;
}
goalType.onchange = syncType;
syncType();
void (async () => {
  const me = await api("/api/profile");
  if (me.status === 401) { location.href = "/login?next=/goals/new"; return; }
  if (!me.ok || !me.json.can_post_goals) {
    gate.hidden = false;
    go.disabled = true;
    err.textContent = "Only Root Record members can post public goals.";
    err.hidden = false;
  }
})();
document.querySelector('input[name="image"]').onchange = async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  err.hidden = true;
  info.hidden = true;
  image = "";
  try {
    const out = await resizeGoalImage(f);
    image = out.dataUrl;
    preview.src = image;
    preview.hidden = false;
    info.textContent = "Ready: " + out.dim + "×" + out.dim + " JPEG, " + out.kb + " KB.";
    info.hidden = false;
  } catch (ex) {
    preview.hidden = true;
    err.textContent = ex instanceof Error ? ex.message : "Could not resize image.";
    err.hidden = false;
    e.target.value = "";
  }
};
document.getElementById("create").onsubmit = async (e) => {
  e.preventDefault();
  err.hidden = true;
  go.disabled = true;
  go.textContent = "Creating…";
  const fd = new FormData(e.target);
  const money = String(fd.get("goal_type") || "money") !== "non_money";
  const cost = String(fd.get("cost") || "").trim();
  if (!image) {
    err.textContent = "Add a goal image first.";
    err.hidden = false;
    go.disabled = false;
    go.textContent = "Create public goal";
    return;
  }
  try {
    const body = {
      title: fd.get("title"),
      purpose: fd.get("purpose"),
      public: true,
      public_enabled: true,
      requires_money: money,
      percent_complete: Math.max(0, Math.min(100, Math.floor(Number(fd.get("percent") || 0)))),
      target_date_est: String(fd.get("target_date") || "").trim() || null,
      image_base64: image,
    };
    if (money) {
      body.estimated_cost_cents = cost ? Math.round(Number(cost) * 100) : null;
      body.token_symbol = String(fd.get("symbol") || "").trim().toUpperCase().slice(0, 8);
    } else {
      body.estimated_cost_cents = null;
    }
    const res = await api("/api/goals", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (res.status === 401) { location.href = "/login?next=/goals/new"; return; }
    if (res.status === 403) { location.href = "/memberships"; return; }
    if (!res.ok) { err.textContent = String(res.json.detail || "Could not create goal."); err.hidden = false; return; }
    const id = String((res.json.goal && res.json.goal.id) || "");
    if (id) location.href = "/goals/" + id;
    else { err.textContent = "Created, but no id came back."; err.hidden = false; }
  } catch (ex) {
    err.textContent = ex instanceof Error ? ex.message : "failed";
    err.hidden = false;
  } finally {
    go.disabled = false;
    go.textContent = "Create public goal";
  }
};
`,
  );
}

function membershipsPage(): Response {
  return html(
    "Memberships — Root Record Goals",
    `<section class="hero">
      <h1>Memberships</h1>
      <p>Public goals are a member tool. Membership unlocks posting, editing your own goals, and the higher daily limits. Anyone can still donate to a live goal.</p>
    </section>
    <div class="panel" style="max-width:560px">
      <div class="kicker">What you unlock</div>
      <ul>
        <li>Create public goals with artwork, a USD target, and a donate wallet</li>
        <li>Mint a goal token on the first deposit (100 tokens = 100% of target)</li>
        <li>Withdraw after the target is met, or refund and close before then</li>
        <li>Monthly Pro or Lifetime — Lifetime is permanent</li>
      </ul>
      <p class="hint" id="billHint">Checkout uses your signed-in Root Record account.</p>
      <p class="err" id="err" hidden></p>
      <button class="btn btnGold" type="button" id="go">Start membership checkout</button>
      <a class="btn btnGhost" href="/goals/new" style="margin-top:8px">Back to post a goal</a>
    </div>`,
    `
const err = document.getElementById("err");
const go = document.getElementById("go");
const hint = document.getElementById("billHint");
let posting = false;
void (async () => {
  const me = await api("/v1/me");
  if (me.ok && (me.json.life_member || me.json.pro_unlocked)) {
    posting = true;
    hint.textContent = me.json.life_member
      ? "You already have lifetime membership. You can post goals."
      : "You already have an active membership. You can post goals.";
    go.textContent = "Post a goal";
  }
})();
go.onclick = async () => {
  if (posting) { location.href = "/goals/new"; return; }
  err.hidden = true;
  go.disabled = true;
  go.textContent = "Opening checkout…";
  try {
    const me = await api("/v1/me");
    if (me.status === 401) { location.href = "/login?next=/memberships"; return; }
    const res = await api("/v1/billing/checkout", { method: "POST", body: "{}" });
    const url = String(res.json.url || "");
    if (!res.ok || !url) {
      err.textContent = String(res.json.detail || "Checkout is not available yet. Sign in and try again, or ask Ava on Discord.");
      err.hidden = false;
      return;
    }
    location.href = url;
  } catch (ex) {
    err.textContent = ex instanceof Error ? ex.message : "failed";
    err.hidden = false;
  } finally {
    go.disabled = false;
    if (!posting) go.textContent = "Start membership checkout";
  }
};
`,
  );
}

function detailPage(id: string): Response {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return html(
    "Goal — Root Record",
    `<div id="page"><p class="empty">Loading…</p></div>`,
    `
const id = ${JSON.stringify(safeId)};
function tokenStatusLabel(status) {
  const s = String(status || "pending");
  if (s === "awaiting_first_deposit") return "Token mints on the first deposit (Solana devnet). 100 tokens = 100% of the target.";
  if (s === "awaiting_treasury") return "Waiting for 0.01 SOL on the treasury (mainnet, or devnet fallback) to mint the token.";
  if (s === "mint_failed") return "Token mint failed. Will retry on the next deposit.";
  if (s === "wallet_pending") return "Custodial wallet pending.";
  if (s === "pending") return "Waiting for first deposit to mint.";
  return s;
}
function tokenHref(mint, cluster) {
  const c = String(cluster || "devnet");
  return c === "mainnet" || c === "mainnet-beta"
    ? ("https://solscan.io/token/" + encodeURIComponent(mint))
    : ("https://solscan.io/token/" + encodeURIComponent(mint) + "?cluster=" + encodeURIComponent(c));
}
void (async () => {
  const res = await api("/public/g/" + encodeURIComponent(id));
  const el = document.getElementById("page");
  if (!res.ok || !res.json.goal) { el.innerHTML = '<p class="err">Goal not found.</p>'; return; }
  const g = res.json.goal;
  document.title = esc(g.title) + " — Root Goals";
  const raised = Number(g.raised_cents || 0);
  const target = Number(g.estimated_cost_cents || 0);
  const money = g.requires_money !== false && target > 0;
  const pctRaw = money
    ? Math.round((raised / target) * 100)
    : Math.max(0, Math.min(100, Math.floor(Number(g.percent_complete) || 0)));
  const pct = Math.min(100, Math.max(0, pctRaw));
  const img = g.image_url ? "style='background-image:url(" + JSON.stringify(g.image_url) + ")'" : "";
  const wallet = g.donate_wallet || "";
  const stripe = g.stripe_payment_link || "";
  const mint = g.token_mint || "";
  const donations = Array.isArray(g.donations) ? g.donations : [];
  const live = g.live_balance || {};
  const qr = wallet ? "/public/g/" + encodeURIComponent(id) + "/qr.svg" : "";
  const closed = String(g.funding_status || "open") === "refunded";
  const withdrawn = String(g.funding_status || "open") === "withdrawn";
  const setLive = (b) => {
    const solEl = document.getElementById("liveSol");
    const usdcEl = document.getElementById("liveUsdc");
    if (solEl) solEl.textContent = Number(b.sol || 0).toFixed(4) + " SOL";
    if (usdcEl) usdcEl.textContent = Number(b.usdc || 0).toFixed(2) + " USDC";
  };
  const progressMeta = money
    ? (esc(usd(raised)) + ' raised' + (target ? ' of ' + esc(usd(target)) + ' (' + pctRaw + '%)' : '') +
      (g.token_symbol ? ' · token ' + esc(g.token_symbol) : '') +
      (g.tokens_minted ? ' · ' + Number(g.tokens_minted).toLocaleString() + ' minted' : ''))
    : (pct + '% complete' + (g.target_date_est ? ' · est completion ' + esc(g.target_date_est) : '') +
      (g.token_symbol ? ' · token ' + esc(g.token_symbol) : ''));
  el.innerHTML =
    '<div class="detail"><div>' +
    '<div class="kicker">' + (g.is_server_goal ? "Ava · server goal" : "Community goal") +
      (money ? "" : " · non-monetary") + '</div>' +
    '<h1 style="font-size:36px;letter-spacing:-.04em;margin:8px 0 12px">' + esc(g.title) + '</h1>' +
    posterBy(g.posted_by) +
    '<p id="editWrap" hidden style="margin:12px 0 0"><a class="btn btnGhost" href="/goals/' + esc(id) + '/edit">Edit goal</a></p>' +
    '<p style="color:var(--muted);margin:18px 0;white-space:pre-wrap">' + esc(g.purpose || "No write-up yet.") + '</p>' +
    '<div class="art" ' + img + '></div>' +
    '<div class="meta" style="margin-top:16px">' + progressMeta + '</div>' +
    '<div class="meter" style="margin-top:10px"><span style="width:' + pct + '%"></span></div>' +
    (money
      ? '<p class="hint">100 goal tokens = 100% of the target. A $1 landed deposit on a $100 goal mints 1 token after ATA rent. Over 100% still mints. Token is Solana <strong>devnet</strong> for now.</p>' +
        moneyProcessArticle(g)
      : '<p class="hint">Non-monetary goal — progress is set by the creator (percent complete and estimated completion date). Donations are optional.</p>') +
    '</div><aside class="panel">' +
    '<h2>Live wallet <span class="meta">(Solana ' + esc(g.solana_cluster || g.token_cluster || "devnet") + ")</span></h2>" +
    '<div class="liveBal"><b id="liveSol">' + esc(Number(live.sol || 0).toFixed(4) + " SOL") + '</b>' +
      '<span id="liveUsdc">' + esc(Number(live.usdc || 0).toFixed(2) + " USDC") + '</span></div>' +
    (wallet
      ? (qr ? '<div class="qrWrap"><img alt="Donate QR" src="' + esc(qr) + '"/></div>' : "") +
        '<div class="addr">' + esc(wallet) + '</div>' +
        '<button type="button" class="btn btnGhost" id="copy">Copy address</button>' +
        '<p class="meta">Scan or send <strong>devnet</strong> SOL / Circle <strong>devnet USDC</strong> to this address. Same pubkey as mainnet, separate test balances.</p>'
      : '<p class="meta">Custodial wallet pending.</p>') +
    '<p class="hint">Card donations include a <strong>5%</strong> Root Record fee (Stripe processing is extra). Solana and USDC transfers include <strong>2.5%</strong>. Goal tokens use the landed amount minus ATA rent. You cannot withdraw until the target is met. Canceling refunds what is left after ATA rent and transaction fees.</p>' +
    (closed ? '<p class="err">This goal was canceled. Donations are closed.</p>' : withdrawn ? '<p class="hint">Creator already withdrew. New deposits still mint goal tokens.</p>' : '') +
    '<h2 style="margin-top:22px">From your Root wallet</h2>' +
    '<p class="meta" style="margin-top:0">Transfer SOL or USDC we host for you. Sign in if the buttons are locked.</p>' +
    '<div id="hostedDonate">' +
      '<div class="amtRow"><label>SOL <input id="solAmt" type="number" min="0.001" step="0.001" value="0.001"/></label>' +
      '<button type="button" class="btn btnGold" id="donateSol">Send SOL</button></div>' +
      '<div class="amtRow" style="margin-top:10px"><label>USDC <input id="usdcAmt" type="number" min="1" step="1" value="5"/></label>' +
      '<button type="button" class="btn btnGhost" id="donateUsdc">Send USDC</button></div>' +
      '<div class="amtRow" style="margin-top:10px"><label>Ava Shards <input id="shardAmt" type="number" min="1" step="1" value="100"/></label>' +
      '<button type="button" class="btn btnGhost" id="donateShards">Send shards</button></div>' +
      '<p class="meta" id="hostedBal">Checking your Root wallet…</p>' +
      '<p class="ok" id="donateOk" hidden></p>' +
      '<p class="err" id="donateErr" hidden></p>' +
    '</div>' +
    (stripe && !closed ? '<a class="btn btnGold" style="margin-top:16px" href="' + esc(stripe) + '">Donate with card</a>' : (closed ? '' : '<p class="meta">Stripe link pending.</p>')) +
    (mint
      ? '<p class="meta" style="margin-top:14px">Token <a href="' + esc(tokenHref(mint, g.token_cluster)) + '" target="_blank" rel="noreferrer">' + esc(g.token_symbol || "mint") + '</a> · ' + esc(g.token_cluster || "devnet") + '</p>'
      : '<p class="meta">Token status: ' + esc(tokenStatusLabel(g.token_status)) + '</p>') +
    '<div id="creatorBox"></div>' +
    (donations.length
      ? '<div style="margin-top:16px"><h2>Recent donations</h2>' + donations.map((d) =>
          '<div class="meta">' + esc(donationLine(d)) + '</div>'
        ).join("") + '</div>'
      : '') +
    '</aside></div>';
  const copy = document.getElementById("copy");
  if (copy && wallet) copy.onclick = () => navigator.clipboard.writeText(wallet);
  const mine = await api("/api/goals/" + encodeURIComponent(id));
  if (mine.ok) {
    const wrap = document.getElementById("editWrap");
    if (wrap) wrap.hidden = false;
    const f = mine.json.funding || {};
    const box = document.getElementById("creatorBox");
    if (box) {
      box.innerHTML =
        '<h2 style="margin-top:22px">Creator</h2>' +
        '<p class="meta">' + (f.goal_met ? "Target met." : "Target not met yet.") +
        (f.funding_status ? " Status: " + esc(f.funding_status) + "." : "") + '</p>' +
        '<p class="hint">' + esc(f.refund_warning || "") + '</p>' +
        '<p class="ok" id="payOk" hidden></p><p class="err" id="payErr" hidden></p>' +
        '<button type="button" class="btn btnGold" id="withdrawGo"' + (f.can_withdraw ? "" : " disabled") + '>Withdraw to my Root wallet</button>' +
        '<button type="button" class="btn btnGhost" id="refundGo" style="margin-top:8px"' + (f.can_refund ? "" : " disabled") + '>Refund everyone and close</button>';
      const wbtn = document.getElementById("withdrawGo");
      const rbtn = document.getElementById("refundGo");
      const act = async (path, warn) => {
        const ok = document.getElementById("payOk");
        const er = document.getElementById("payErr");
        ok.hidden = true; er.hidden = true;
        if (warn && !confirm(warn)) return;
        const res = await api("/api/goals/" + encodeURIComponent(id) + path, { method: "POST", body: "{}" });
        if (!res.ok) { er.textContent = String(res.json.detail || "Failed."); er.hidden = false; return; }
        ok.textContent = path === "/withdraw" ? "Withdrawn to your Root wallet." : "Goal closed. Remaining funds refunded minus ATA rent and transaction fees.";
        ok.hidden = false;
        location.reload();
      };
      if (wbtn) wbtn.onclick = () => act("/withdraw", "Withdraw the remaining SOL and USDC to your Root wallet? You cannot refund after this.");
      if (rbtn) rbtn.onclick = () => act("/refund", f.refund_warning || "Cancel and refund?");
    }
  }
  const refreshLive = async () => {
    const bres = await api("/public/g/" + encodeURIComponent(id) + "/balance");
    if (bres.ok && bres.json.live_balance) setLive(bres.json.live_balance);
  };
  const hostedBal = document.getElementById("hostedBal");
  const donateSol = document.getElementById("donateSol");
  const donateUsdc = document.getElementById("donateUsdc");
  const donateShards = document.getElementById("donateShards");
  const walletCluster = encodeURIComponent(g.token_cluster || g.solana_cluster || "devnet");
  const wres = await api("/api/wallet?cluster=" + walletCluster);
  const sres = await api("/api/shards");
  const setHosted = (w, s) => {
    hostedBal.textContent =
      "Your Root wallet (" + ((w && w.solana_cluster) || "devnet") + "): " + Number((w && w.sol) || 0).toFixed(4) + " SOL · " +
      Number((w && w.usdc) || 0).toFixed(2) + " USDC · " +
      Number((s && s.shards) || 0).toLocaleString() + " Ava Shards";
  };
  if ((wres.ok || sres.ok) && !closed) {
    setHosted(wres.json, sres.json);
    await api("/api/goals/" + encodeURIComponent(id) + "/claim-tokens", { method: "POST", body: "{}" });
    const send = async (asset, amount, btn) => {
      const ok = document.getElementById("donateOk");
      const er = document.getElementById("donateErr");
      ok.hidden = true; er.hidden = true;
      btn.disabled = true;
      const res = await api("/api/goals/" + encodeURIComponent(id) + "/donate", {
        method: "POST",
        body: JSON.stringify({ asset, amount: Number(amount) }),
      });
      btn.disabled = false;
      if (!res.ok) { er.textContent = String(res.json.detail || "Transfer failed."); er.hidden = false; return; }
      const minted = Number(res.json.tokens_minted || 0);
      ok.textContent = minted
        ? ("Landed. Minted " + minted.toLocaleString() + " goal tokens to your Root wallet.")
        : "Sent from your Root wallet.";
      ok.hidden = false;
      const again = await api("/api/wallet?cluster=" + walletCluster);
      const sagain = await api("/api/shards");
      setHosted(again.json, sagain.json);
      await refreshLive();
    };
    donateSol.onclick = () => send("sol", document.getElementById("solAmt").value, donateSol);
    donateUsdc.onclick = () => send("usdc", document.getElementById("usdcAmt").value, donateUsdc);
    donateShards.onclick = () => send("shards", document.getElementById("shardAmt").value, donateShards);
  } else if (closed) {
    hostedBal.textContent = "Donations are closed on this goal.";
    donateSol.disabled = true;
    donateUsdc.disabled = true;
    donateShards.disabled = true;
  } else {
    hostedBal.innerHTML = '<a href="/login?next=/goals/' + esc(id) + '">Sign in</a> to transfer from your Root wallet.';
    const goLogin = () => { location.href = "/login?next=/goals/" + encodeURIComponent(id); };
    donateSol.onclick = goLogin;
    donateUsdc.onclick = goLogin;
    donateShards.onclick = goLogin;
  }
})();
`,
  );
}

function shardsPage(): Response {
  return html(
    "Ava Shards — Root Record",
    `<section class="hero">
      <h1>Ava Shards</h1>
      <p>The new lore of vote shards: each shard is direct voting power. <strong>100 shards = $1</strong> always. Ava mints 42% of supply so she holds 42% vote power. Players transact Root Shards with each other from the hosted wallet. The on-chain mint is not live yet — the ledger still counts, and USD value is the peg.</p>
      <p class="hint" style="margin-top:12px"><strong>Ava Embers ($EMBER)</strong> is the Pump.fun street token on <strong>mainnet</strong> — heat, not a vote. Forge is paused while Goals Solana is on devnet so you are not spending real SOL. Shards and card still work.</p>
    </section>
    <div class="panel" style="max-width:520px">
      <div class="kicker">Governance</div>
      <div class="liveBal"><b id="avaPct">—</b><span id="govLine">Loading supply…</span></div>
      <p class="meta" id="mintLine"></p>
    </div>
    <form class="form" id="buy" style="margin-top:28px">
      <h2>Buy with card</h2>
      <p class="hint">Credits Ava Shards to your Root Record wallet after Stripe confirms. 100 shards per $1.</p>
      <label>USD <input name="usd" type="number" min="1" max="500" step="1" value="5"/></label>
      <p class="meta" id="quote">500 Ava Shards · $5.00</p>
      <p class="ok" id="ok" hidden></p>
      <p class="err" id="err" hidden></p>
      <button class="btn btnGold" type="submit" id="go">Buy Ava Shards</button>
    </form>
    <form class="form" id="send" style="margin-top:28px">
      <h2>Send to a player</h2>
      <label>Their profile slug <input name="slug" placeholder="ava" maxlength="40"/></label>
      <label>Shards <input name="amount" type="number" min="1" step="1" value="100"/></label>
      <p class="ok" id="sendOk" hidden></p>
      <p class="err" id="sendErr" hidden></p>
      <button class="btn btnGhost" type="submit" id="sendGo">Send shards</button>
    </form>
    <div class="panel" id="emberBox" style="max-width:520px;margin-top:28px">
      <div class="kicker">Pump.fun · Ava Embers</div>
      <h2 style="margin:8px 0 8px">Swap with Ava</h2>
      <p class="meta" id="emberLore">Street heat. Not voting power until Ava forges it.</p>
      <p class="meta" id="emberPrice">Price: …</p>
      <p class="meta" id="emberBal">Your Embers: …</p>
      <p id="emberLink"></p>
      <label>Embers to forge <input id="emberAmt" type="number" min="0" step="any" placeholder="all"/></label>
      <p class="ok" id="emberOk" hidden></p>
      <p class="err" id="emberErr" hidden></p>
      <button type="button" class="btn btnGold" id="emberGo">Forge into Ava Shards</button>
    </div>
    <p class="meta" id="mine">Your balance: …</p>`,
    `
const form = document.getElementById("buy");
const send = document.getElementById("send");
const quote = document.getElementById("quote");
const err = document.getElementById("err");
const ok = document.getElementById("ok");
const go = document.getElementById("go");
form.usd.oninput = () => {
  const n = Math.max(1, Math.floor(Number(form.usd.value) || 1));
  quote.textContent = (n * 100).toLocaleString() + " Ava Shards · " + usd(n * 100);
};
void (async () => {
  const g = await api("/public/shards");
  if (g.ok) {
    document.getElementById("avaPct").textContent = Number(g.json.ava_vote_pct || 42).toFixed(2) + "% Ava";
    document.getElementById("govLine").textContent =
      Number(g.json.ava_shards || 0).toLocaleString() + " Ava · " +
      Number(g.json.player_shards || 0).toLocaleString() + " players · " +
      Number(g.json.total_shards || 0).toLocaleString() + " total · $" +
      Number(g.json.usd_value_if_minted || 0).toFixed(2) + " peg";
    document.getElementById("mintLine").textContent = g.json.mint_base58
      ? ("Mint " + g.json.mint_base58)
      : "On-chain mint pending. Ledger balance is live for tips, sends, and vote math.";
  }
  const em = await api("/public/embers");
  if (em.ok) {
    document.getElementById("emberLore").textContent = em.json.lore || "";
    const px = em.json.usd_per_ember;
    document.getElementById("emberPrice").textContent = px
      ? ("Live USDC: $" + Number(px).toPrecision(6) + " per Ember · forges " + Number(em.json.shards_per_ember || 0).toLocaleString() + " Ava Shards per Ember")
      : (em.json.mint ? "Waiting on a USDC price (launch on Pump.fun first)." : "Not launched yet. After the Pump.fun coin exists, Ava can set the mint.");
    if (em.json.pump_fun_url) {
      document.getElementById("emberLink").innerHTML = '<a href="' + esc(em.json.pump_fun_url) + '" target="_blank" rel="noreferrer">Buy $EMBER on Pump.fun</a> — then send tokens to your Root wallet address on <a href="/profile">Profile</a>.';
    }
    if (em.json.testnet || em.json.solana_cluster === "devnet") {
      const btn = document.getElementById("emberGo");
      btn.disabled = true;
      btn.textContent = "Forge paused on devnet";
      if (em.json.ember_note) document.getElementById("emberLore").textContent = em.json.ember_note;
    }
  }
  const me = await api("/api/shards");
  if (me.status === 401) {
    document.getElementById("mine").innerHTML = '<a href="/login?next=/shards">Sign in</a> to buy, send, or forge shards.';
    document.getElementById("emberBal").innerHTML = '<a href="/login?next=/shards">Sign in</a> to swap Embers with Ava.';
    go.onclick = (e) => { e.preventDefault(); location.href = "/login?next=/shards"; };
    return;
  }
  if (me.ok) document.getElementById("mine").textContent = "Your balance: " + Number(me.json.shards || 0).toLocaleString() + " Ava Shards ($" + Number(me.json.usd || 0).toFixed(2) + " peg)";
  if (new URLSearchParams(location.search).get("bought")) {
    ok.textContent = "Payment received. Shards land on your wallet after Stripe confirms.";
    ok.hidden = false;
  }
  const eme = await api("/api/embers");
  if (eme.ok) {
    document.getElementById("emberBal").textContent =
      "Your Embers: " + Number(eme.json.embers || 0).toLocaleString() +
      " · USDC value $" + Number(eme.json.usd_value || 0).toFixed(4) +
      " · forges " + Number(eme.json.shards_out || 0).toLocaleString() + " Ava Shards";
    if (eme.json.embers) document.getElementById("emberAmt").value = String(eme.json.embers);
  }
})();
form.onsubmit = async (e) => {
  e.preventDefault();
  err.hidden = true; ok.hidden = true;
  go.disabled = true;
  const res = await api("/api/shards/checkout", { method: "POST", body: JSON.stringify({ usd: Number(form.usd.value) }) });
  go.disabled = false;
  if (!res.ok) { err.textContent = String(res.json.detail || "Checkout failed."); err.hidden = false; return; }
  location.href = res.json.url;
};
send.onsubmit = async (e) => {
  e.preventDefault();
  const se = document.getElementById("sendErr");
  const so = document.getElementById("sendOk");
  se.hidden = true; so.hidden = true;
  const res = await api("/api/shards/send", { method: "POST", body: JSON.stringify({ slug: send.slug.value, amount: Number(send.amount.value) }) });
  if (!res.ok) { se.textContent = String(res.json.detail || "Send failed."); se.hidden = false; return; }
  so.textContent = "Sent " + Number(send.amount.value).toLocaleString() + " shards.";
  so.hidden = false;
  const me = await api("/api/shards");
  if (me.ok) document.getElementById("mine").textContent = "Your balance: " + Number(me.json.shards || 0).toLocaleString() + " Ava Shards";
};
document.getElementById("emberGo").addEventListener("click", async (e) => {
  e.preventDefault();
  const eok = document.getElementById("emberOk");
  const eerr = document.getElementById("emberErr");
  const btn = document.getElementById("emberGo");
  eok.hidden = true; eerr.hidden = true;
  btn.disabled = true;
  const raw = String(document.getElementById("emberAmt").value || "").trim();
  const body = raw ? { amount: Number(raw) } : {};
  const res = await api("/api/embers/swap", { method: "POST", body: JSON.stringify(body) });
  btn.disabled = false;
  if (res.status === 401) { location.href = "/login?next=/shards"; return; }
  if (!res.ok) { eerr.textContent = String(res.json.detail || "Swap failed."); eerr.hidden = false; return; }
  eok.textContent = "Forged " + Number(res.json.shards_out || 0).toLocaleString() + " Ava Shards from $" + Number(res.json.usd_value || 0).toFixed(4) + " USDC of Embers.";
  eok.hidden = false;
  const me = await api("/api/shards");
  if (me.ok) document.getElementById("mine").textContent = "Your balance: " + Number(me.json.shards || 0).toLocaleString() + " Ava Shards ($" + Number(me.json.usd || 0).toFixed(2) + " peg)";
  const eme = await api("/api/embers");
  if (eme.ok) {
    document.getElementById("emberBal").textContent =
      "Your Embers: " + Number(eme.json.embers || 0).toLocaleString() +
      " · USDC value $" + Number(eme.json.usd_value || 0).toFixed(4) +
      " · forges " + Number(eme.json.shards_out || 0).toLocaleString() + " Ava Shards";
  }
});
`,
  );
}

function profilePage(): Response {
  return html(
    "Profile — Root Record",
    `<section class="hero">
      <h1>Profile</h1>
      <p>Public goals show <strong>Posted by</strong> this name and picture. If you play Minecraft, we use your skin/head until you upload a photo.</p>
    </section>
    <form class="form" id="prof">
      <img class="avatarLg" id="preview" alt=""/>
      <label>Display name <input name="display_name" maxlength="40" required/></label>
      <label>Bio <textarea name="bio" maxlength="280" placeholder="Optional"></textarea></label>
      <label>Minecraft username <input name="minecraft_username" maxlength="16" placeholder="optional"/></label>
      <p class="hint">We'll pull your Minecraft head automatically. Upload a picture to replace it.</p>
      <label>Profile picture <input name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif"/></label>
      <p class="meta" style="margin:8px 0 0">Hosted Solana address</p>
      <div class="addr" id="myWallet">Loading…</div>
      <button type="button" class="btn btnGhost" id="copyWallet">Copy address</button>
      <p class="hint">This is the wallet we host for you. While Goals is on <strong>devnet</strong>, send <strong>devnet SOL</strong> and Circle <strong>devnet USDC</strong> here (same address as mainnet, different balances). No Phantom/Solflare connection required. Card donations stay real USD.</p>
      <p class="ok" id="info" hidden></p>
      <p class="err" id="err" hidden></p>
      <button class="btn btnGold" type="submit" id="go">Save profile</button>
    </form>
    <section style="margin-top:48px">
      <div class="sectionHead" style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:14px">
        <h2 class="kicker" style="margin:0">RootMC gallery</h2>
        <a href="/gallery/upload">Upload screenshot</a>
      </div>
      <div id="shots" class="grid"></div>
    </section>`,
    `
const err = document.getElementById("err");
const info = document.getElementById("info");
const go = document.getElementById("go");
const preview = document.getElementById("preview");
const form = document.getElementById("prof");
let image = "";
void (async () => {
  const res = await api("/api/profile");
  if (res.status === 401) { location.href = "/login?next=/profile"; return; }
  if (!res.ok) { err.textContent = String(res.json.detail || "Could not load profile."); err.hidden = false; return; }
  const p = res.json.profile || {};
  form.display_name.value = p.display_name || "";
  form.bio.value = p.bio || "";
  form.minecraft_username.value = p.minecraft_username || "";
  if (p.avatar_url) { preview.src = p.avatar_url + "?t=" + Date.now(); preview.hidden = false; }
  const addr = p.custodial_wallet_pubkey || "";
  const box = document.getElementById("myWallet");
  box.textContent = addr || "No hosted wallet yet.";
  const copyW = document.getElementById("copyWallet");
  if (addr) copyW.onclick = () => navigator.clipboard.writeText(addr);
  else copyW.hidden = true;
  const gal = await api("/api/gallery");
  const shots = document.getElementById("shots");
  const mine = ((gal.json.items || []).filter((x) => x.kind === "shot" && x.status === "public"));
  shots.innerHTML = mine.length
    ? mine.map((s) => '<a class="poster" href="' + esc(s.image_url) + '" target="_blank"><div class="shot" style="background-image:url(' + JSON.stringify(s.image_url) + ')"></div><div class="posterBody"><div class="meta">' + esc(s.caption || "Screenshot") + '</div></div></a>').join("")
    : '<p class="empty">No screenshots yet. <a href="/gallery/upload">Add one</a>.</p>';
})();
form.image.onchange = async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    const out = await resizeGoalImage(f);
    image = out.dataUrl;
    preview.src = image;
    preview.hidden = false;
    info.textContent = "New picture ready (" + out.kb + " KB). Save to apply.";
    info.hidden = false;
  } catch (ex) {
    err.textContent = ex instanceof Error ? ex.message : "Could not resize image.";
    err.hidden = false;
  }
};
form.onsubmit = async (e) => {
  e.preventDefault();
  err.hidden = true;
  go.disabled = true;
  go.textContent = "Saving…";
  try {
    const body = {
      display_name: form.display_name.value,
      bio: form.bio.value,
      minecraft_username: form.minecraft_username.value,
      avatar_kind: image ? "upload" : (form.minecraft_username.value ? "minecraft" : "auto"),
    };
    if (image) body.image_base64 = image;
    const res = await api("/api/profile", { method: "PATCH", body: JSON.stringify(body) });
    if (!res.ok) { err.textContent = String(res.json.detail || "Could not save."); err.hidden = false; return; }
    info.textContent = "Saved. Goals will show Posted by " + String((res.json.profile || {}).display_name || "") + ".";
    info.hidden = false;
    const p = res.json.profile || {};
    if (p.avatar_url) preview.src = p.avatar_url + "?t=" + Date.now();
  } catch (ex) {
    err.textContent = ex instanceof Error ? ex.message : "failed";
    err.hidden = false;
  } finally {
    go.disabled = false;
    go.textContent = "Save profile";
  }
};
`,
  );
}

function editGoalPage(id: string): Response {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return html(
    "Edit goal — Root Record",
    `<section class="hero">
      <h1>Edit goal</h1>
      <p>Update the write-up, progress, completion date estimate, USD target, symbol, or token artwork. Donate wallet stays the same. For money goals you can raise the USD target, not lower it.</p>
    </section>
    <form class="form" id="edit">
      <label>Title <input name="title" required maxlength="80"/></label>
      <label>What this is for <textarea name="purpose" required></textarea></label>
      <label>Goal type
        <select name="goal_type" id="goalType">
          <option value="money">Money — raise funds</option>
          <option value="non_money">Non-monetary — track progress</option>
        </select>
      </label>
      <div id="moneyFields">
        <label>Target (USD) <input name="cost" type="number" min="0" step="1"/></label>
        <p class="hint">You can raise the target after publish. You cannot lower it.</p>
        <label>Token symbol (optional) <input name="symbol" maxlength="8"/></label>
      </div>
      <div id="progressFields">
        <label>Percent complete <input name="percent" type="number" min="0" max="100" step="1" value="0"/></label>
        <label>Estimated completion date <input name="target_date" type="date"/></label>
        <p class="hint">Owners can update percent complete and the completion estimate anytime.</p>
      </div>
      <label>Replace image (optional) <input name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif"/></label>
      <img class="preview" id="preview" hidden alt=""/>
      <p class="ok" id="info" hidden></p>
      <p class="err" id="err" hidden></p>
      <button class="btn btnGold" type="submit" id="go">Save changes</button>
      <a class="btn btnGhost" id="back" href="/goals/${safeId}">Back to page</a>
    </form>`,
    `
const id = ${JSON.stringify(safeId)};
const err = document.getElementById("err");
const info = document.getElementById("info");
const go = document.getElementById("go");
const preview = document.getElementById("preview");
const form = document.getElementById("edit");
const goalType = document.getElementById("goalType");
const moneyFields = document.getElementById("moneyFields");
const progressFields = document.getElementById("progressFields");
let image = "";
function syncType() {
  const money = goalType.value !== "non_money";
  moneyFields.hidden = !money;
  // Percent + date stay editable for both types (money goals can also track work %).
  progressFields.hidden = false;
}
goalType.onchange = syncType;
void (async () => {
  const mine = await api("/api/goals/" + encodeURIComponent(id));
  if (mine.status === 401) { location.href = "/login?next=/goals/" + encodeURIComponent(id) + "/edit"; return; }
  if (!mine.ok) { err.textContent = String(mine.json.detail || "You cannot edit this goal."); err.hidden = false; go.disabled = true; return; }
  const g = mine.json.goal || {};
  form.title.value = g.title || "";
  form.purpose.value = g.purpose || "";
  goalType.value = g.requires_money === false ? "non_money" : "money";
  const minUsd = Math.max(0, Math.ceil(Number(g.estimated_cost_cents || 0) / 100));
  form.cost.min = String(minUsd);
  if (minUsd > 0) form.cost.value = String(minUsd);
  form.symbol.value = g.token_symbol || "";
  form.percent.value = String(Math.max(0, Math.min(100, Math.floor(Number(g.percent_complete) || 0))));
  form.target_date.value = String(g.target_date_est || "").slice(0, 10);
  if (g.image_url) { preview.src = g.image_url; preview.hidden = false; }
  syncType();
})();
form.image.onchange = async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    const out = await resizeGoalImage(f);
    image = out.dataUrl;
    preview.src = image;
    preview.hidden = false;
  } catch (ex) {
    err.textContent = ex instanceof Error ? ex.message : "Could not resize image.";
    err.hidden = false;
  }
};
form.onsubmit = async (e) => {
  e.preventDefault();
  err.hidden = true;
  go.disabled = true;
  go.textContent = "Saving…";
  const money = goalType.value !== "non_money";
  const cost = String(form.cost.value || "").trim();
  const nextCents = cost ? Math.round(Number(cost) * 100) : 0;
  const minCents = Math.max(0, Math.floor(Number(form.cost.min || 0) * 100));
  if (money && cost && nextCents < minCents) {
    err.textContent = "Goal target can only be raised, not lowered.";
    err.hidden = false;
    go.disabled = false;
    go.textContent = "Save changes";
    return;
  }
  try {
    const body = {
      title: form.title.value,
      purpose: form.purpose.value,
      requires_money: money,
      percent_complete: Math.max(0, Math.min(100, Math.floor(Number(form.percent.value || 0)))),
      target_date_est: String(form.target_date.value || "").trim() || null,
      public_enabled: true,
    };
    if (money) {
      body.estimated_cost_cents = cost ? nextCents : null;
      body.token_symbol = String(form.symbol.value || "").trim().toUpperCase().slice(0, 8);
    } else {
      body.estimated_cost_cents = null;
    }
    if (image) body.image_base64 = image;
    const res = await api("/api/goals/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(body) });
    if (!res.ok) { err.textContent = String(res.json.detail || "Could not save."); err.hidden = false; return; }
    location.href = "/goals/" + id;
  } catch (ex) {
    err.textContent = ex instanceof Error ? ex.message : "failed";
    err.hidden = false;
  } finally {
    go.disabled = false;
    go.textContent = "Save changes";
  }
};
`,
  );
}

function galleryPage(): Response {
  return html(
    "RootMC gallery — Root Record",
    `<section class="hero">
      <h1>RootMC gallery</h1>
      <p>Player screenshots from the server. Signed-in players can add shots to their profile, or submit a screenshot as proof of a rule break.</p>
      <p><a class="btn btnGold" style="width:auto;display:inline-flex;padding:10px 16px" href="/gallery/upload">Upload</a></p>
    </section>
    <div id="list"><p class="empty">Loading…</p></div>`,
    `
void (async () => {
  const res = await api("/public/gallery");
  const shots = Array.isArray(res.json.shots) ? res.json.shots : [];
  const el = document.getElementById("list");
  if (!shots.length) { el.innerHTML = '<p class="empty">No screenshots yet. <a href="/gallery/upload">Be the first</a>.</p>'; return; }
  el.innerHTML = '<div class="grid">' + shots.map((s) =>
    '<a class="poster" href="' + esc(s.image_url) + '" target="_blank">' +
    '<div class="shot" style="background-image:url(' + JSON.stringify(s.image_url) + ')"></div>' +
    '<div class="posterBody">' + posterBy(s.posted_by) +
    (s.caption ? '<div class="meta">' + esc(s.caption) + '</div>' : '') +
    '</div></a>'
  ).join("") + '</div>';
})();
`,
  );
}

function galleryUploadPage(): Response {
  return html(
    "Upload — RootMC gallery",
    `<section class="hero">
      <h1>Upload a screenshot</h1>
      <p>Add it to your public RootMC profile gallery, or send it privately to staff as proof of a rule break.</p>
    </section>
    <form class="form" id="up">
      <label>This is
        <select name="kind">
          <option value="shot">A gallery screenshot (public on my profile)</option>
          <option value="report">Proof of a rule break (staff only)</option>
        </select>
      </label>
      <label id="accusedWrap" hidden>Player involved <input name="accused" maxlength="16" placeholder="Minecraft username"/></label>
      <label>Caption / what happened <textarea name="caption" maxlength="280"></textarea></label>
      <label>Screenshot <input name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required/></label>
      <img class="previewWide" id="preview" hidden alt=""/>
      <p class="ok" id="info" hidden></p>
      <p class="err" id="err" hidden></p>
      <button class="btn btnGold" type="submit" id="go">Upload</button>
    </form>`,
    `
const form = document.getElementById("up");
const err = document.getElementById("err");
const info = document.getElementById("info");
const go = document.getElementById("go");
const preview = document.getElementById("preview");
const accusedWrap = document.getElementById("accusedWrap");
let image = "";
form.kind.onchange = () => { accusedWrap.hidden = form.kind.value !== "report"; };
void (async () => {
  const me = await api("/api/profile");
  if (me.status === 401) location.href = "/login?next=/gallery/upload";
})();
form.image.onchange = async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  err.hidden = true;
  try {
    const out = await resizeShotImage(f);
    image = out.dataUrl;
    preview.src = image;
    preview.hidden = false;
    info.textContent = "Ready: " + out.kb + " KB.";
    info.hidden = false;
  } catch (ex) {
    err.textContent = ex instanceof Error ? ex.message : "Could not compress screenshot.";
    err.hidden = false;
  }
};
form.onsubmit = async (e) => {
  e.preventDefault();
  if (!image) { err.textContent = "Add a screenshot first."; err.hidden = false; return; }
  go.disabled = true;
  go.textContent = "Uploading…";
  err.hidden = true;
  try {
    const kind = form.kind.value;
    const res = await api("/api/gallery", {
      method: "POST",
      body: JSON.stringify({
        kind,
        caption: form.caption.value,
        accused_minecraft: form.accused.value,
        image_base64: image,
      }),
    });
    if (res.status === 401) { location.href = "/login?next=/gallery/upload"; return; }
    if (!res.ok) { err.textContent = String(res.json.detail || "Upload failed."); err.hidden = false; return; }
    location.href = kind === "report" ? "/gallery/upload?sent=1" : "/gallery";
  } catch (ex) {
    err.textContent = ex instanceof Error ? ex.message : "failed";
    err.hidden = false;
  } finally {
    go.disabled = false;
    go.textContent = "Upload";
  }
};
if (new URLSearchParams(location.search).get("sent")) {
  info.textContent = "Report sent to staff. They can see the screenshot; it is not public.";
  info.hidden = false;
}
`,
  );
}

function galleryReportsPage(): Response {
  return html(
    "Rule-break reports — RootMC",
    `<section class="hero">
      <h1>Rule-break reports</h1>
      <p>Staff inbox. These screenshots are not on the public gallery.</p>
    </section>
    <div id="list"><p class="empty">Loading…</p></div>`,
    `
void (async () => {
  const res = await api("/api/gallery/reports");
  const el = document.getElementById("list");
  if (res.status === 401) { location.href = "/login?next=/gallery/reports"; return; }
  if (res.status === 403) { el.innerHTML = '<p class="err">Staff only.</p>'; return; }
  const reports = res.json.reports || [];
  if (!reports.length) { el.innerHTML = '<p class="empty">No reports.</p>'; return; }
  el.innerHTML = reports.map((r) =>
    '<div class="panel" style="margin-bottom:16px">' +
    '<div class="kicker">' + esc(r.status || "open") + '</div>' +
    posterBy(r.reporter) +
    '<p class="meta">About <strong>' + esc(r.accused_minecraft || "unknown") + '</strong> · ' + esc(String(r.created_at || "").slice(0,16).replace("T"," ")) + '</p>' +
    '<p>' + esc(r.caption || "") + '</p>' +
    '<img class="previewWide" src="' + esc(r.image_url) + '" alt="proof"/>' +
    (r.status === "open"
      ? '<div class="row" style="margin-top:10px"><button class="btn btnGold" data-act="reviewed" data-id="' + esc(r.id) + '">Mark reviewed</button><button class="btn btnGhost" data-act="dismissed" data-id="' + esc(r.id) + '">Dismiss</button></div>'
      : "") +
    '</div>'
  ).join("");
  el.onclick = async (e) => {
    const b = e.target.closest("button[data-id]");
    if (!b) return;
    b.disabled = true;
    await api("/api/gallery/" + b.getAttribute("data-id"), { method: "PATCH", body: JSON.stringify({ status: b.getAttribute("data-act") }) });
    location.reload();
  };
})();
`,
  );
}

function playerPage(slug: string): Response {
  const safe = slug.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
  return html(
    "Player — Root Record",
    `<div id="page"><p class="empty">Loading…</p></div>`,
    `
const slug = ${JSON.stringify(safe)};
void (async () => {
  const res = await api("/public/u/" + encodeURIComponent(slug));
  const el = document.getElementById("page");
  if (!res.ok) { el.innerHTML = '<p class="err">Profile not found.</p>'; return; }
  const p = res.json.profile || {};
  const shots = res.json.shots || [];
  document.title = esc(p.display_name || slug) + " — RootMC";
  el.innerHTML =
    '<section class="hero"><div class="row">' +
    (p.avatar_url ? '<img class="avatarLg" src="' + esc(p.avatar_url) + '" alt=""/>' : "") +
    '<div><h1>' + esc(p.display_name || slug) + '</h1>' +
    (p.minecraft_username ? '<p class="meta">Minecraft ' + esc(p.minecraft_username) + '</p>' : "") +
    '</div></div>' +
    (p.bio ? '<p style="margin-top:16px;color:var(--muted)">' + esc(p.bio) + '</p>' : "") +
    (p.solana_address
      ? '<p class="meta" style="margin-top:16px">Solana</p><div class="addr">' + esc(p.solana_address) + '</div>'
      : "") +
    '</section>' +
    '<h2 class="kicker">Gallery</h2>' +
    (shots.length
      ? '<div class="grid">' + shots.map((s) =>
          '<a class="poster" href="' + esc(s.image_url) + '" target="_blank"><div class="shot" style="background-image:url(' + JSON.stringify(s.image_url) + ')"></div>' +
          (s.caption ? '<div class="posterBody"><div class="meta">' + esc(s.caption) + '</div></div>' : "") +
          '</a>'
        ).join("") + '</div>'
      : '<p class="empty">No public screenshots yet.</p>');
})();
`,
  );
}

export function serveGoalsSitePage(pathname: string, search: URLSearchParams): Response | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/login") {
    const next = search.get("next") || "/goals/new";
    return loginPage(next);
  }
  if (p === "/profile") return profilePage();
  if (p === "/shards") return shardsPage();
  if (p === "/gallery") return galleryPage();
  if (p === "/gallery/upload") return galleryUploadPage();
  if (p === "/gallery/reports") return galleryReportsPage();
  const player = p.match(/^\/u\/([^/]+)$/);
  if (player) return playerPage(player[1]);
  if (p === "/goals") return catalogPage();
  if (p === "/goals/new") return newGoalPage();
  if (p === "/memberships") return membershipsPage();
  const edit = p.match(/^\/goals\/([^/]+)\/edit$/);
  if (edit) return editGoalPage(edit[1]);
  const m = p.match(/^\/goals\/([^/]+)$/);
  if (m) return detailPage(m[1]);
  return null;
}
