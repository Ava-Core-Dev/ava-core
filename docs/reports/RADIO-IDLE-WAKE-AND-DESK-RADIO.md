# Plan — Idle wake, overlays, Root Record Radio (Desk)

**Date:** 2026-09-05 (HST)  
**Machine:** AVA-CORE · live tree `C:\Users\rootr\ava`  
**Status:** Building (2026-09-05) — public wake copy cleaned (no operator jargon). Desk Radio, OBS idle, mid-track clock-kill removed, ffmpeg live remux `/radio/live.mp3` when on air. Icecast still optional.  
**Operator ask:** No stray pages broadcasting; efficient when nobody is visiting; Banished-style wake page; full Radio in Ava Desk (local listen without Cloudflare); program feed = music + reports + chimes (not desktop audio); optional mic; fold pending work.

---

## Truth check (why this plan exists)

| Claim that failed | What was actually true |
|---|---|
| “Nothing OBS-related was running” | OBS.exe was closed, but `/obs/audio-stream` was a **live browser player**. Opening it played the desk music bed via SSE. |
| Overlays are “only for OBS” | Any browser can open `/obs/*` URLs. If the page polls or holds SSE, this PC pays for it. |

**Rule going forward:** A page that can play or push stream audio is **broadcast infrastructure**. It stays dark unless (a) OBS is open for stream overlays, or (b) Radio is intentionally on for website/Desk listeners.

---

## Goal in one picture

```
Desktop speakers (Cursor, Discord, games)
        ≠ never captured into Radio

Program bus (files only):
  music bed + report MP3s + chimes (+ optional mic insert)
        │
        ├─► Desk local player  →  http://127.0.0.1:8787/...   (toggle ON/OFF)
        ├─► Radio encoder CLI  →  Icecast mount (when Radio “on air” / wake)
        └─► Public site player →  rootrecord.cloud / radio page (when visited)

OBS browser overlays → only when obs64 is running (already partly gated)
Public boards (solar, status) → wake-on-visit holding page when idle
```

---

## Part A — Stop unpaid broadcast / idle efficiency

### A1. Overlay & stream URL policy
- **OBS-only URLs** (`/obs/hud`, `/obs/reactions`, `/obs/audio-stream`, scene boards meant for Browser Sources):  
  - No SSE / no autoplay / no polling when `obs64` is not running.  
  - DONE for `/obs/audio-stream` + `/obs/audio-events` (idle HTML / 204).  
  - **Pending:** same gate for other chatty `/obs/*` pages (timers, EventSource, 1s polls).
- **Website URLs** (rootrecord.cloud, avaivy.cloud, origin pages meant for people): allowed to wake work on visit.
- Never treat “Desk has music” as “Radio is on air.”

### A2. Banished-style wake-on-visit (recommended: **yes**)
**Idea:** Cloudflare (or origin static) shows a full-bleed holding page: large slow-spinning / scrolling circle, short rotating lines underneath (flavor, not fake live watts). First paint is static. A light `GET /api/wake` (or health) starts heavy services only when someone lands.

**Why it fits**
- You keep the laptop usable when nobody is on the site.
- Visitors still get a proper “Root Record is here” moment instead of a hung spinner or CORE OFFLINE panic.
- Matches Banished / old strategy-game loading feel without claiming live numbers.

**Options (pick in build order)**

| Option | What sleeps | What stays warm | Cost |
|---|---|---|---|
| **A — Soft idle (prefer)** | Radio encoder, OBS jobs, heavy overlay SSE | Origin `:8787` thin (health, wake, static) | Low; Desk still works |
| **B — Hard idle** | Origin uvicorn too | Only Cloudflare static + wake Worker that starts Task Scheduler job | Best RAM; Desk must start origin |
| **C — Always warm** | Nothing | Everything | Worst for “I want my PC” |

**Recommendation:** Option **A**. Keep a thin origin for Desk + Telegram. Put Radio encode + OBS automation behind **presence** (visitor or Desk “Radio on” or `obs64`).

**Wake page copy rules:** random looping statements only from an approved list (no invented SOC/watts). Examples: “Root Record · Hawaiʻi”, “Waiting for the board…”, “Solar desk warms up when you visit.”

### A3. Already done (this session) — keep
- OBS work requires `AVA_ENABLE_OBS=1` **and** OBS process.
- AdSense/AdMob Discord off; economy Discord hourly.
- Telegram reaction → gold context.

---

## Part B — Root Record Radio (Desk + site)

### B1. Desk UI
- Rename Ava Desk tab **Audio → Radio**.
- Full service panel (not a thin status strip):
  - **Local playback** ON/OFF (hears program bus on this PC via **localhost**, never forced through Cloudflare).
  - **On air / encoder** ON/OFF (serves visitors when Radio is wanted).
  - Now playing · up next · bed state · pending voice/reports.
  - Chime / report insert controls (reuse current voice APIs).
  - **Mic** arm/disarm (see B4).
- Closing Desk does not have to kill the encoder if “on air” is sticky; local playback should follow Desk preference (already related to music-wanted / close behavior — verify, don’t assume).

### B2. Program bus (what gets broadcast)
**Include (files / Ava-generated only):**
- Music library bed
- Report MP3s / voice clips
- Time chimes
- Optional mic insert when armed

**Never include:**
- Windows desktop mix / “what you hear” (WASAPI loopback off by default — do not install a “broadcast my PC” path as the radio)
- Discord/Cursor/game audio

That split is how you avoid echo/feedback: Desk local player plays the **same program files** the encoder uses; speakers are not fed back into the encoder.

### B3. Free CLI stack (best fit on this Windows box)

| Role | Pick | Why |
|---|---|---|
| Mount / public listen URL | **Icecast2** | Free, standard HTTP radio, players and `<audio>` work |
| Program mixer / playlist / inserts | **Liquidsoap** *or* keep **Ava director** as mixer + **ffmpeg** → Icecast | Liquidsoap is the classic free radio CLI; Ava already owns ducking/chimes — ffmpeg encode may ship faster with less new surface |
| Local Desk hear | Existing pygame / director **or** HTML `<audio>` on `127.0.0.1` | No Cloudflare hop |

**Practical build path (recommended):**
1. **Phase 1:** Desk “Radio” tab + local playback toggle on localhost program stream (even if stream is origin-hosted file/SSE first).
2. **Phase 2:** Install Icecast2; director/ffmpeg pushes **program bus only** to a local mount (`http://127.0.0.1:8000/rootrecord.mp3` or similar).
3. **Phase 3:** Public page embeds that mount via tunnel/Worker only when on-air + wake.
4. **Phase 4 (optional):** Liquidsoap if playlist/scheduling outgrows director.

Do **not** start encoder on every boot. Start on: Desk “On air”, or first public Radio visit after wake, or explicit cron “show window.”

### B4. Mic option
- Desk toggle: Mic armed → encoder accepts a **named** input (USB mic / Voicemeeter channel), not “default desktop.”
- Default **off**. Clear “LIVE MIC” mark on Desk.
- Duck music under mic (same idea as voice REPORT hold).
- No Discord voice capture unless explicitly added later.

### B5. Public Radio page
- Real product page on rootrecord.cloud (or agreed host): player + now playing + short status.
- First visit can hit Banished wake if encoder was cold.
- Desk never needs this path for local listen.

---

## Part C — Pending backlog (fold into this plan)

Carry-forward from `HANDOFF-2026-09-04-SESSION-FAILURES.md` + this session. Do not mark done until measured live.

### P0 — hear / stability
1. **Music mid-track cut** — still OPEN; Radio Phase 1 must not paper over it. Prefer one bed player that finishes the file (measure >50% duration).
2. **Duplicate uvicorn / hung `:8787`** — listening ≠ healthy; single origin; short health timeouts.
3. **Morning-boot-replay after noon** — OPEN gate: disarm after successful midday/noon; do not fix unless building that cron (operator previously asked document-only once — confirm before coding).

### P1 — Radio / idle (this ask)
4. Gate remaining chatty `/obs/*` overlays (same rule as audio-stream).
5. Desk Audio → **Radio** full service UI + localhost local playback.
6. Icecast (+ ffmpeg or Liquidsoap) program-bus encode; no desktop loopback.
7. Banished wake-on-visit static page + soft idle (Option A).
8. Mic arm path (after encode works).

### P2 — voice / reports / weather
9. NWS CAP → full director clip board (pack A exists; board held).
10. Midday/report play hooks — verify live, not claimed.
11. Weather GIFs collector still missing; Desk Open paths on C:.
12. Evening long-form report generator (scaffold only today).
13. Seek-resume music after REPORT (restarts from top today).

### P3 — public / infra
14. D1 heartbeat credentials (historical 403/7403).
15. Kīlauea product keep-alive — do not point consumer apps at OmniBook until ready.
16. Nav 7-link guard on avaivy — re-verify live HTML.
17. Guest chat IP / Worker offline copy — re-verify under load.

### Done recently (do not re-litigate)
- NWS product time + restitch; earthquake hourly magnitude buckets; EcoFlow AC gate OFF@300; Telegram reaction gold; AdSense Discord off; economy Discord 1h; OBS process gate + idle audio-stream.

---

## Suggested build order

1. **Lock idle:** finish overlay poll/SSE audit; document which URLs are OBS-only vs public.  
2. **Music P0** enough that Radio won’t inherit a broken bed.  
3. **Desk rename + Radio panel** (local playback localhost).  
4. **Icecast + program encode** (on-air toggle).  
5. **Banished wake page** on public Radio / optional status doors.  
6. **Mic** last.

---

## Decision checklist (answer when building starts)

- [ ] Soft idle (A) vs hard idle (B)?
- [ ] Icecast+ffmpeg first, or Liquidsoap from day one?
- [ ] Public Radio host: rootrecord.cloud path? (exact URL)
- [ ] On-air sticky after Desk close: yes/no?
- [ ] Morning-boot-replay: fix now or leave OPEN until asked?

---

## Out of scope for this plan

- Broadcasting real desktop audio as the station.
- Turning OBS into the radio encoder.
- Paid cloud TTS spend (still halted unless reopened).
- Claiming Icecast/Liquidsoap installed before a live check on this PC.
