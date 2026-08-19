# Primary session 08182026

**5-minute read** · 18–19 August 2026 (HST) · Ava SSD cutover night

The one-line version: Ava now lives in a clean `/home/ava-core/ava` on this SSD, speaks on the desktop, writes a real heartbeat to Cloudflare, and pushes every local save to GitHub by herself. Pages belong on Vercel. DNS and the home tunnel stay on Cloudflare. Minecraft apps and plugins were pointed at the new API names. The edge finally has a D1 cache and Hyperdrive into live MySQL.

---

## Where everything sits now

`/home/ava-core/ava` is the home tree. It is not a junk drawer.

| Path | Job |
|------|-----|
| `media/` (1.2 GB) | The only media library — audio, video, images, persona, chat history, reports, OBS |
| `workstations/` (~1 GB source) | Built tools: Android, 43 Paper plugins, old CF workers, RootMC web, OBS |
| `ava-core-v2/` | Live monorepo (symlink to the checkout) |
| `tools/` | `print_directory.py` and friends |
| `data/` / `logs/` | Runtime only |

If you ask Ava about a clip, a report, or last week’s Grok dump, it is under `media/`. If you open Android Studio or Gradle, it is under `workstations/`. Crons write reports and generated audio into `media/`, not scatter files around the disk.

Ollama on this box is `ava-ivy`, `qwen3:8b`, and embeddings. The Minecraft builder model (Andy-3.6, 4.7 GB) was deleted.

---

## The build that actually runs

The old Node stack was retired in place. Python FastAPI on port **8787** is the brain. The Electron GUI starts core and voice when you open it and is supposed to stop them when you close it. Sleepy/night mode is gone — she relays until the machine is actually off.

Voice is local: Stream Director queues clips, `mpg123` hits PulseAudio, half-hour chimes use `time_HHMM.mp3` plus the bell. Startup speech is wired to GUI load. If you did not hear a bell at some point tonight, it was a real bug (missing `os` import, then the core process never draining its own audio queue). Both were fixed and verified.

Minecraft in the GUI no longer imports dead Node modules. Status, log tail, RCON, and start/stop go through the Python API. RCON `list` returned a live empty server. The test-server ping was wrongly hitting a LAN IP with no route; it now probes localhost.

A **Crons** group in the Terminal tab can fire any Python job on demand, including the new **D1 sync**.

---

## Cloud: plumbing vs pages

Honest split, and it held:

- **Cloudflare stays** for DNS and the `cloudflared` tunnel. Vercel cannot reach a box in the house.
- **Pages and easy edits go to Vercel** (Next.js under `packages/web/`). Copy lives in `content.json` so you can change words from GitHub’s pencil with no Cursor.

The tunnel that actually works is **ava-core-v2** in the *new* Cloudflare account (`ava-origin.rootmc.net` → `127.0.0.1:8787`). Heartbeat writes to D1 `ava-heartbeat` every 60 seconds using the global API key (the `cfk_` value is not a Bearer token). Status pages can say HOST ONLINE with reason `ok`.

Workers: `ava-api`, `rootmc-api`, `rootrecord-api`. Public names:

| Traffic | URL |
|---------|-----|
| Minecraft | `https://api.rootmc.info` |
| Ava / status | `https://avaivy.cloud` |
| Kīlauea / real life | `https://api.rootrecord.online` |

`rootrecord.info` → `.online` 301 is coded; it activates when that zone sits in the new account.

Vercel: the `avaivy.cloud` app is in the repo and ready. Programmatic deploy hit a **403** — the logged-in Vercel identity is not Owner on the RootRecord team. Import `Ava-Core-Dev/ava-core` in the dashboard (root directory `packages/web/avaivy.cloud`), then every git push deploys. Same for `rootrecord.online`.

---

## Tonight’s late block (04:00–04:40)

**Media.** Your empty `files.log` skeleton at `ava/media` was filled: words, numbers, time clips, bell, portraits, thumbs, persona files, notes, plans, and the Grok/Cursor conversation archive under `documents/context/AIConversations`. The live app’s `apps/media` and `apps/voice/assets` are symlinks into that one tree. Hurricane Lala’s 5 GB dump was left in the archive on purpose.

**Auto-push.** Every 2 minutes, and again when a Cursor session ends, dirty files commit and push to `github.com/Ava-Core-Dev/ava-core`. `.env` never goes up. Timer `ava-auto-push.timer` is enabled. After that, a save on this machine is a GitHub commit; once Vercel is linked, it is a deploy.

**Workstations + APIs.** Android Kīlauea now targets `api.rootrecord.online`. RootMC Android and Paper plugins target `api.rootmc.info`. 155 source files patched. Shipping that to phones and Shockbyte still needs a Gradle rebuild of APKs and JARs.

**D1 + Hyperdrive.** New D1 `rootmc-live` (edge cache of balances/status). Hyperdrive `rootmc-core-mysql` into Shockbyte MySQL. Host cron `d1-sync` every 5 minutes is the “Ava does the math, edge keeps a copy” path. The worker uploaded with those bindings. It could **not** attach routes because **`rootmc.info` is not in the new Cloudflare account yet.**

First sync run found the local MySQL mirror missing `rootstat_player_balances`. Shockbyte is the real primary; the cron will keep trying. Schema comments with stray semicolons also tripped D1 once — that is fixed in the SQL file.

---

## What you still have to do (short)

1. **Vercel:** Owner role on RootRecord, then Import the GitHub repo for `avaivy.cloud` and `rootrecord.online`. Point those hostnames at Vercel when the first deploy is green.
2. **Cloudflare dashboard, once:** add/migrate `rootmc.info` (and `rootrecord.info` when you are ready). Open Workers once so `workers.dev` exists — cron triggers stay unregistered until that happens (error 10063).
3. **xAI key:** present but credits were exhausted. New key from console.x.ai if Grok/TTS should work.
4. **Rebuild** Android APKs and plugin JARs so production servers and phones actually use the new API hosts.
5. **Paper world** still runs from `ava-old-20260819` (`workstations/minecraft-test-live`). Move it when you want the archive disk gone.
6. **Old Node leftover from boot** was still on the machine earlier tonight (cron junk in MySQL, extra tunnels). A logout/reboot on the updated autostart, or a deliberate kill + `ava-minecraft-test.service`, finishes that. Killing it takes Paper with it until systemd owns the server.

Git history for this night starts at `f24a31f` (v2.0) and ends at auto-sync `87b8062`. `EDITING.md` in the repo is the no-Cursor path: edit `content.json` on GitHub, wait a minute.

That is the session. The SSD is the source of truth. The archive is a museum until you unplug it on purpose.
