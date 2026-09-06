"""Public radio player HTML — shared program, member skip, guest clock."""
from __future__ import annotations


def player_html(*, brand: str = "Root Record Radio", site_label: str = "RootRecord") -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{brand} · Live</title>
<style>
  :root {{
    --ink:#e8e4d9; --muted:#9a9588; --ring:#c4a574; --bg:#0c0d10;
    --ok:#7d9a6a; --bad:#b87a6a; --line:rgba(232,228,217,.12);
  }}
  * {{ box-sizing:border-box; }}
  html,body{{margin:0;min-height:100%;background:radial-gradient(900px 600px at 50% 0%,#1a1820 0%,var(--bg) 55%);
    color:var(--ink);font-family:system-ui,sans-serif;}}
  .top{{
    display:flex;flex-wrap:wrap;gap:.75rem 1.25rem;align-items:center;justify-content:space-between;
    padding:.85rem 1.25rem;border-bottom:1px solid var(--line);
    background:rgba(0,0,0,.25);
  }}
  .top nav{{display:flex;flex-wrap:wrap;gap:.85rem 1.1rem;font-size:.88rem;}}
  .top a{{color:var(--muted);text-decoration:none;}}
  .top a:hover{{color:var(--ink);}}
  .auth a{{color:var(--ring);}}
  .wrap{{max-width:32rem;margin:0 auto;padding:2rem 1.25rem 3rem;display:flex;flex-direction:column;gap:1rem;}}
  .brand{{letter-spacing:.2em;text-transform:uppercase;font-size:.72rem;color:var(--muted);}}
  #title{{font-family:Georgia,"Iowan Old Style",serif;font-size:clamp(1.35rem,3.5vw,1.85rem);line-height:1.25;margin:0;}}
  #desc{{color:var(--muted);font-size:.95rem;line-height:1.45;margin:0;min-height:2.8em;}}
  #status{{opacity:.75;font-size:.85rem;}}
  audio{{width:100%;margin-top:.2rem;}}
  .controls{{display:flex;gap:.65rem;flex-wrap:wrap;align-items:center;}}
  .controls button{{
    appearance:none;border:1px solid rgba(196,165,116,.35);background:rgba(255,255,255,.04);
    color:var(--ink);padding:.55rem 1rem;border-radius:6px;cursor:pointer;font-size:.9rem;
  }}
  .controls button:hover{{border-color:var(--ring);}}
  .controls button.on-like{{border-color:var(--ok);color:var(--ok);}}
  .controls button.on-dislike{{border-color:var(--bad);color:var(--bad);}}
  .counts{{font-size:.8rem;color:var(--muted);}}
  .banner{{
    padding:.85rem 1rem;border:1px solid var(--line);border-radius:8px;
    background:rgba(255,255,255,.03);font-size:.9rem;line-height:1.45;color:var(--muted);
  }}
  .banner strong{{color:var(--ink);font-weight:600;}}
  .banner a{{color:var(--ring);}}
  .meta-row{{display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;font-size:.85rem;color:var(--muted);}}
  .top-up{{
    display:none;appearance:none;border:1px solid var(--ring);background:rgba(196,165,116,.12);
    color:var(--ink);padding:.45rem .9rem;border-radius:6px;cursor:pointer;font-size:.85rem;text-decoration:none;
  }}
  .top-up.show{{display:inline-block;}}
  a{{color:var(--ring);}}
  .fb-open{{
    appearance:none;border:1px solid var(--line);background:transparent;
    color:var(--muted);padding:.4rem .75rem;border-radius:6px;cursor:pointer;font-size:.85rem;
  }}
  .fb-open:hover{{color:var(--ink);border-color:var(--ring);}}
  .fb-backdrop{{
    display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:40;
    align-items:flex-end;justify-content:center;padding:1rem;
  }}
  .fb-backdrop.show{{display:flex;}}
  .fb-modal{{
    width:min(28rem,100%);background:#14151a;border:1px solid var(--line);border-radius:12px;
    padding:1.15rem 1.2rem 1.25rem;box-shadow:0 18px 50px rgba(0,0,0,.45);
  }}
  .fb-modal h2{{font-family:Georgia,"Iowan Old Style",serif;font-size:1.25rem;margin:0 0 .35rem;font-weight:500;}}
  .fb-modal p{{margin:0 0 .85rem;color:var(--muted);font-size:.9rem;line-height:1.45;}}
  .fb-modal label{{display:block;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 .3rem;}}
  .fb-modal textarea,.fb-modal input{{
    width:100%;margin:0 0 .75rem;padding:.6rem .65rem;border-radius:6px;
    border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--ink);font:inherit;
  }}
  .fb-modal textarea{{min-height:6.5rem;resize:vertical;}}
  .fb-actions{{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;}}
  .fb-actions button{{
    appearance:none;border:1px solid rgba(196,165,116,.35);background:rgba(255,255,255,.04);
    color:var(--ink);padding:.5rem .9rem;border-radius:6px;cursor:pointer;font-size:.88rem;
  }}
  .fb-actions button.primary{{border-color:var(--ring);background:rgba(196,165,116,.15);}}
  .fb-actions button.listening{{border-color:var(--ok);color:var(--ok);}}
  .fb-status{{font-size:.82rem;color:var(--muted);min-height:1.2em;margin:.55rem 0 0;}}
</style>
</head>
<body>
  <header class="top">
    <nav aria-label="Homes">
      <a href="https://avaivy.cloud/">Ava Home</a>
      <a href="https://rootrecord.cloud/">Root Record Home</a>
      <a href="https://rootmc.net/">RootMC Home</a>
    </nav>
    <div class="auth" id="auth-slot"><a id="login-link" href="https://rootrecord.cloud/account">Sign in</a></div>
  </header>
  <div class="wrap">
    <div class="brand">{brand}</div>
    <p id="status">Connecting…</p>
    <h1 id="title">Now playing</h1>
    <p id="desc"></p>
    <audio id="player" controls preload="none" controlsList="nodownload noplaybackrate"></audio>
    <div class="controls" id="controls">
      <button type="button" id="btn-like">Like</button>
      <button type="button" id="btn-dislike">Dislike</button>
      <button type="button" id="btn-skip" hidden>Skip for me</button>
      <span class="counts" id="counts"></span>
    </div>
    <div class="meta-row">
      <span id="member-line"></span>
      <a class="top-up" id="top-up" href="https://rootrecord.cloud/root-units">Top Up</a>
    </div>
    <div class="banner" id="banner"></div>
    <p id="hurricane-line" style="opacity:.75;font-size:.88rem;line-height:1.4;margin:0"></p>
    <div class="meta-row">
      <button type="button" class="fb-open" id="fb-open">Share a thought</button>
    </div>
    <p style="opacity:.7;font-size:.85rem;margin:0">Live from the Pacific Root Server · {site_label}</p>
  </div>
  <div class="fb-backdrop" id="fb-backdrop" role="dialog" aria-modal="true" aria-labelledby="fb-title" hidden>
    <div class="fb-modal">
      <h2 id="fb-title">Tell us about the radio</h2>
      <p>Opinions, song ideas, what to play more of, or what to ease off. Guests welcome.</p>
      <label for="fb-msg">Your words</label>
      <textarea id="fb-msg" maxlength="4000" placeholder="What should Root Record Radio hear?"></textarea>
      <label for="fb-email">Reply email (optional)</label>
      <input id="fb-email" type="email" maxlength="160" placeholder="you@example.com" autocomplete="email"/>
      <div class="fb-actions">
        <button type="button" id="fb-speak">Speak</button>
        <button type="button" class="primary" id="fb-send">Send</button>
        <button type="button" id="fb-close">Close</button>
      </div>
      <p class="fb-status" id="fb-status"></p>
    </div>
  </div>
<script>
const LIVE = '/radio/live.mp3';
const ACCOUNT = 'https://rootrecord.cloud/account';
const player = document.getElementById('player');
const status = document.getElementById('status');
const titleEl = document.getElementById('title');
const descEl = document.getElementById('desc');
const counts = document.getElementById('counts');
const btnLike = document.getElementById('btn-like');
const btnDislike = document.getElementById('btn-dislike');
const btnSkip = document.getElementById('btn-skip');
const banner = document.getElementById('banner');
const memberLine = document.getElementById('member-line');
const topUp = document.getElementById('top-up');
const loginLink = document.getElementById('login-link');
const SITE = location.hostname || '';
let currentId = null;
let myVote = null;
let session = {{ signed_in:false, member:false, can_skip:false, guest_limit_s:600 }};
let guestAllowed = true;
let pausedForGuest = false;
let playingTrackId = null;

function portalToken() {{
  try {{ return localStorage.getItem('rootrecord_portal_token') || ''; }} catch (e) {{ return ''; }}
}}
function guestId() {{
  try {{
    let v = localStorage.getItem('rr_radio_guest');
    if (!v) {{
      v = (crypto.randomUUID && crypto.randomUUID()) || ('g' + Math.random().toString(36).slice(2));
      localStorage.setItem('rr_radio_guest', v);
    }}
    return v;
  }} catch (e) {{ return 'anon'; }}
}}
function authHeaders() {{
  const h = {{ 'Content-Type': 'application/json' }};
  const t = portalToken();
  if (t) h.Authorization = 'Bearer ' + t;
  return h;
}}
function loginHref() {{
  const next = encodeURIComponent(location.href);
  return ACCOUNT + (ACCOUNT.indexOf('?') >= 0 ? '&' : '?') + 'next=' + next;
}}

function paintSession() {{
  loginLink.href = loginHref();
  loginLink.textContent = session.signed_in ? 'Account' : 'Sign in';
  btnSkip.hidden = !session.can_skip;
  if (session.member) {{
    memberLine.textContent = (session.lifetime ? 'Lifetime · ' : 'Member · ') + (session.balance ?? 0) + ' Root Units';
    topUp.classList.toggle('show', !!session.top_up);
    if (session.top_up_url) topUp.href = session.top_up_url;
    banner.innerHTML = '<strong>Your skips stay with you.</strong> Everyone hears the same live board; members can skip a song for their own listen and we will not bring that one back for you.';
  }} else if (session.signed_in) {{
    memberLine.textContent = 'Signed in';
    topUp.classList.remove('show');
    banner.innerHTML = 'Membership unlocks all-day listening, personal skip, and likes that steer the board. <a href="' + (session.billing_url || 'https://rootrecord.cloud/billing') + '">Become a member</a>';
  }} else {{
    memberLine.textContent = '';
    topUp.classList.remove('show');
    const m = Math.max(1, Math.round((session.guest_limit_s || 600) / 60));
    banner.innerHTML = 'Guests can listen for about ' + m + ' minutes, then the player pauses. <a href="' + loginHref() + '">Sign in</a> as a member for the full board.';
  }}
}}

function paintMeta(j) {{
  titleEl.textContent = j.title || j.name || 'Now playing';
  descEl.textContent = j.description || '';
  currentId = j.id || null;
  counts.textContent = currentId ? ((j.likes || 0) + ' likes · ' + (j.dislikes || 0) + ' dislikes') : '';
  btnLike.classList.toggle('on-like', myVote === 'like');
  btnDislike.classList.toggle('on-dislike', myVote === 'dislike');
}}

function playLive(meta, force) {{
  if (pausedForGuest || !guestAllowed) return;
  if (session.member && meta && meta.id && meta.skip_for_you) {{
    status.textContent = 'Skipped for you — waiting for the next song…';
    return;
  }}
  const base = LIVE;
  const need = force || player.getAttribute('data-base') !== base || player.paused || !player.src;
  if (need) {{
    player.setAttribute('data-base', base);
    player.src = base + '?t=' + Date.now();
    player.play().catch(()=>{{}});
  }}
  playingTrackId = (meta && meta.id) || playingTrackId;
  paintMeta(meta || {{}});
  status.textContent = (meta && meta.insert) ? 'Live desk' : 'On air';
}}

async function refreshSession() {{
  try {{
    const j = await fetch('/api/radio/session', {{
      headers: authHeaders(),
      cache: 'no-store'
    }}).then(r => r.json());
    session = j || session;
    paintSession();
  }} catch (e) {{}}
}}

async function heartbeat() {{
  try {{
    const j = await fetch('/api/radio/heartbeat', {{
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({{ guest: guestId(), playing: !player.paused && !pausedForGuest }})
    }}).then(r => r.json());
    if (j.session) {{ session = {{ ...session, ...j.session }}; paintSession(); }}
    if (j.member) {{
      guestAllowed = true;
      pausedForGuest = false;
      if (j.balance != null) {{
        session.balance = j.balance;
        session.top_up = !!j.top_up;
        paintSession();
      }}
    }} else {{
      guestAllowed = !!j.allowed;
      if (!guestAllowed) {{
        pausedForGuest = true;
        try {{ player.pause(); }} catch (e) {{}}
        status.textContent = 'Paused — sign in to keep listening';
        banner.innerHTML = 'Your guest listen wrapped up. <a href="' + loginHref() + '">Sign in</a> to continue.';
      }}
    }}
  }} catch (e) {{}}
}}

async function refreshNow() {{
  try {{
    const j = await fetch('/api/radio/now', {{ headers: authHeaders(), cache: 'no-store' }}).then(r => r.json());
    if (!j.on_air) {{ status.textContent = 'Off air'; return; }}
    if (j.skip_for_you) {{
      status.textContent = 'Skipped for you — waiting for the next song…';
      paintMeta(j);
      return;
    }}
    playLive(j);
  }} catch (e) {{
    status.textContent = 'Holding the line…';
  }}
}}

function needLogin(action) {{
  if (session.member) return false;
  status.textContent = 'Sign in to ' + action;
  banner.innerHTML = '<strong>Members only for that.</strong> <a href="' + loginHref() + '">Sign in</a> to like, dislike, or skip for your own listen.';
  return true;
}}

async function sendVote(vote) {{
  if (!currentId) return;
  if (needLogin(vote === 'like' ? 'like this song' : 'dislike this song')) return;
  myVote = vote;
  btnLike.classList.toggle('on-like', vote === 'like');
  btnDislike.classList.toggle('on-dislike', vote === 'dislike');
  try {{
    const r = await fetch('/api/radio/vote', {{
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({{ id: currentId, vote, voter: guestId(), site: SITE }})
    }});
    const j = await r.json();
    if (j.need_login) {{ needLogin('vote'); return; }}
    if (j.ok) {{
      counts.textContent = (j.likes || 0) + ' likes · ' + (j.dislikes || 0) + ' dislikes';
      status.textContent = vote === 'like' ? 'Noted — this will play more.' : 'Noted — eased off for the board.';
      if (vote === 'dislike' && session.member) {{
        await skipSelf(true);
      }}
    }}
  }} catch (e) {{
    status.textContent = 'Could not save — try again.';
  }}
}}

async function skipSelf(fromDislike) {{
  if (!currentId) return;
  if (needLogin('skip for yourself')) return;
  try {{
    const r = await fetch('/api/radio/skip', {{
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({{ id: currentId }})
    }});
    const j = await r.json();
    if (j.need_login) {{ needLogin('skip'); return; }}
    if (j.ok) {{
      status.textContent = fromDislike
        ? 'Skipped for you — waiting for the next song…'
        : 'Skipped for you — waiting for the next song…';
      try {{ player.pause(); }} catch (e) {{}}
      player.removeAttribute('data-base');
    }}
  }} catch (e) {{
    status.textContent = 'Could not skip — try again.';
  }}
}}

btnLike.addEventListener('click', () => sendVote('like'));
btnDislike.addEventListener('click', () => sendVote('dislike'));
btnSkip.addEventListener('click', () => skipSelf(false));
player.addEventListener('contextmenu', e => e.preventDefault());

const fbBackdrop = document.getElementById('fb-backdrop');
const fbMsg = document.getElementById('fb-msg');
const fbEmail = document.getElementById('fb-email');
const fbStatus = document.getElementById('fb-status');
const fbSpeak = document.getElementById('fb-speak');
let fbRec = null;
let fbListening = false;

function openFeedback() {{
  fbBackdrop.hidden = false;
  fbBackdrop.classList.add('show');
  fbStatus.textContent = '';
  try {{ fbMsg.focus(); }} catch (e) {{}}
}}
function closeFeedback() {{
  stopSpeak();
  fbBackdrop.classList.remove('show');
  fbBackdrop.hidden = true;
}}
function stopSpeak() {{
  fbListening = false;
  fbSpeak.classList.remove('listening');
  fbSpeak.textContent = 'Speak';
  try {{ if (fbRec) fbRec.stop(); }} catch (e) {{}}
}}
function startSpeak() {{
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {{
    fbStatus.textContent = 'This browser cannot take voice here — type instead.';
    return;
  }}
  if (fbListening) {{ stopSpeak(); return; }}
  fbRec = new SR();
  fbRec.lang = 'en-US';
  fbRec.interimResults = true;
  fbRec.continuous = false;
  fbRec.onstart = () => {{
    fbListening = true;
    fbSpeak.classList.add('listening');
    fbSpeak.textContent = 'Listening…';
    fbStatus.textContent = 'Speak now — we will write it in the box.';
  }};
  fbRec.onerror = () => {{
    stopSpeak();
    fbStatus.textContent = 'Could not hear that — try again or type.';
  }};
  fbRec.onend = () => {{
    fbListening = false;
    fbSpeak.classList.remove('listening');
    fbSpeak.textContent = 'Speak';
  }};
  fbRec.onresult = (ev) => {{
    let text = '';
    for (let i = 0; i < ev.results.length; i++) {{
      text += ev.results[i][0].transcript;
    }}
    const cur = (fbMsg.value || '').trim();
    fbMsg.value = (cur ? cur + ' ' : '') + text.trim();
  }};
  try {{ fbRec.start(); }} catch (e) {{
    fbStatus.textContent = 'Mic blocked — allow the mic or type.';
  }}
}}
async function sendFeedback() {{
  const message = (fbMsg.value || '').trim();
  if (!message) {{
    fbStatus.textContent = 'Say or type something first.';
    return;
  }}
  fbStatus.textContent = 'Sending…';
  try {{
    const r = await fetch('/api/feedback', {{
      method: 'POST',
      headers: {{ 'Content-Type': 'application/json', ...authHeaders() }},
      body: JSON.stringify({{
        type: 'radio',
        message,
        reply_email: (fbEmail.value || '').trim() || null,
        surface: 'radio:' + SITE,
        app_id: 'radio',
        track_id: currentId || null,
        track_title: (titleEl.textContent || '').trim() || null
      }})
    }});
    const j = await r.json().catch(() => ({{}}));
    if (!r.ok || !j.ok) {{
      fbStatus.textContent = (j.detail || 'Could not send — try again.');
      return;
    }}
    fbMsg.value = '';
    fbStatus.textContent = 'Got it — thank you.';
    setTimeout(closeFeedback, 900);
  }} catch (e) {{
    fbStatus.textContent = 'Could not send — try again.';
  }}
}}
document.getElementById('fb-open').addEventListener('click', openFeedback);
document.getElementById('fb-close').addEventListener('click', closeFeedback);
fbBackdrop.addEventListener('click', (e) => {{ if (e.target === fbBackdrop) closeFeedback(); }});
fbSpeak.addEventListener('click', startSpeak);
document.getElementById('fb-send').addEventListener('click', sendFeedback);

async function refreshHurricane() {{
  try {{
    const j = await fetch('/api/hurricane/desk', {{ cache: 'no-store' }}).then(r => r.json());
    const el = document.getElementById('hurricane-line');
    if (!el) return;
    el.textContent = (j && j.hawaii) ? j.hawaii : '';
  }} catch (e) {{}}
}}
refreshSession().then(() => {{
  paintSession();
  refreshNow();
  heartbeat();
  refreshHurricane();
}});
const es = new EventSource('/radio/events');
es.onerror = () => {{ status.textContent = 'Holding the line…'; }};
es.addEventListener('play', e => {{
  try {{
    const data = JSON.parse(e.data);
    myVote = null;
    if (pausedForGuest) return;
    // Force reconnect so report/chime inserts land on the continuous live stream.
    playLive({{ ...data, live: LIVE, src: LIVE, insert: !!data.insert }}, true);
  }} catch (err) {{}}
}});
player.addEventListener('ended', () => playLive({{}}, true));
setInterval(refreshNow, 40000);
setInterval(heartbeat, 20000);
setInterval(refreshHurricane, 120000);
</script>
</body>
</html>"""
