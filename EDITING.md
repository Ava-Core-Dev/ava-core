# Editing Ava without Cursor

Everything in this file can be done from a browser on any device, for free.
No terminal, no CLI, no AI agent required.

The rule that makes this work: **any commit pushed to `master` on GitHub is
deployed automatically by Vercel.** You edit a file, click "Commit changes",
and the site is live in about a minute.

Repo: <https://github.com/Ava-Core-Dev/ava-core>

## First-time Vercel import (two Next.js sites, not FastAPI)

The GitHub repo is a Python monorepo. **Do not** import the repo root as FastAPI.
Ava Core stays on the home machine. Vercel only builds the websites.

Create **two** projects from the same repo (`Ava-Core-Dev/ava-core`, branch `master`):

| Project name | Framework | Root Directory | Domain later |
|---|---|---|---|
| `avaivy-cloud` | Next.js | `packages/web/avaivy.cloud` | avaivy.cloud |
| `rootrecord-online` | Next.js | `packages/web/rootrecord.online` | rootrecord.online |

On the import screen:

1. Click **Edit** next to Root Directory and pick the folder above — not `./`.
2. Framework should switch to **Next.js**. If it still says FastAPI, you are on the wrong folder.
3. **Skip the 36 detected environment variables.** Those are home-box secrets (MySQL, Discord, Cloudflare). Vercel pages only need `AVA_ORIGIN_URL=https://ava-origin.rootmc.net` if you set anything at all.
4. If a project named `ava-core` already failed as FastAPI, delete it or ignore it and create the two projects above.

On the Ava machine, **you do not have to remember to push.** A timer checks
every 2 minutes: if anything changed, it commits and uploads to GitHub.
Closing a Cursor agent session also kicks a push. `.env` is never included.

---

## The fastest loop: edit a file on GitHub

1. Open the file on github.com.
2. Click the pencil icon (Edit this file).
3. Make the change.
4. Scroll down, click **Commit changes**.
5. Wait ~60s. Vercel builds and publishes it.

To watch the build: <https://vercel.com/root-record> → pick the project → Deployments.
If a build fails, the site keeps serving the last good version. Nothing breaks.

---

## "I want to change the words on the site"

You almost never need to touch code for this. All the text and links for
avaivy.cloud live in one file:

```
packages/web/avaivy.cloud/src/content.json
```

Change the headline, tagline, nav links, cards, and footer there. It is plain
JSON, so the only rules are:

- Text goes inside `"double quotes"`.
- Every item except the last in a list needs a comma after it.
- Don't delete the `{` `}` `[` `]` brackets.

The goals board is the same idea, different file:

```
packages/web/avaivy.cloud/src/goals.json
```

Each goal is one object. Do not type in a raised total unless a real helper
paid it. Do not add player Gold or ops-buffer as a funding source.


If you paste this file into a free ChatGPT and say *"change the tagline to X and
give me the whole file back"*, it will do it safely. Then paste the result back
into GitHub and commit.

---

## "I want to change how a page looks"

Layout and styling live next to each page:

| What | Where |
|---|---|
| Home page structure | `packages/web/avaivy.cloud/src/app/page.tsx` |
| Home page styling | `packages/web/avaivy.cloud/src/app/page.module.css` |
| Status page | `packages/web/avaivy.cloud/src/app/status/page.tsx` |
| Goals board | `packages/web/avaivy.cloud/src/goals.json` |
| Colors + global styles | `packages/web/avaivy.cloud/src/app/globals.css` |
| Root Record dashboard | `packages/web/rootrecord.online/src/app/page.tsx` |

`.module.css` files are ordinary CSS. Changing a color or font size there is safe.

---

## "I want to add a new page"

Create a folder under `src/app/` with a `page.tsx` inside. The folder name is
the URL.

`src/app/about/page.tsx` becomes `https://avaivy.cloud/about`.

Minimal working page:

```tsx
export default function About() {
  return (
    <main style={{ padding: "4rem", maxWidth: "40rem", margin: "0 auto" }}>
      <h1>About</h1>
      <p>Whatever you want to say.</p>
    </main>
  );
}
```

You can create files directly on GitHub: **Add file → Create new file**, then
type the full path `packages/web/avaivy.cloud/src/app/about/page.tsx`.

---

## Where the data comes from

The websites hold no data of their own. They read it live from Ava on the home
machine, through the Cloudflare tunnel:

```
avaivy.cloud  ──►  https://ava-origin.rootmc.net/api/status    (CPU, uptime, memory)
              ──►  https://ava-origin.rootmc.net/api/activity  (crons, Ollama, jobs)
              ──►  https://ava-origin.rootmc.net/api/solar     (solar report)
```

That address is Ava's own FastAPI server at `127.0.0.1:8787`, published through
the tunnel. So:

- **Host powered on** → pages show live numbers.
- **Host powered off** → the fetch fails and pages show "HOST OFFLINE".

That is deliberate. Reachability *is* the status signal, so there is no second
system to keep in sync.

To add a new number to a page, first check the API returns it by visiting
`https://ava-origin.rootmc.net/api/status` in a browser.

---

## What still lives on Cloudflare (and why)

Pages are on Vercel. Cloudflare keeps only the plumbing you should never need
to edit:

| Stays on Cloudflare | Why it can't move |
|---|---|
| DNS for all domains | The domains' nameservers point at Cloudflare |
| `cloudflared` tunnel | Only way to reach a machine in your house from the internet |
| Cron fallback Workers | They run scheduled jobs *while the home box is off* |

If you never touch `packages/workers/`, nothing about the public sites breaks.

---

## Changing Ava herself (the Python side)

This part runs on the home machine and is **not** deployed by Vercel. Editing
these files on GitHub changes the repo but not the running server until you pull
and restart on the machine.

| What | Where |
|---|---|
| Scheduled jobs and times | `apps/core/scheduler.py` |
| The half-hour chime | `apps/core/crons/hourly_chime.py` |
| Audio queue / OBS | `apps/voice/director.py` |
| Settings and paths | `apps/core/config.py` |
| Secrets | `.env` (never committed) |

To apply changes on the machine:

```bash
cd /home/ava-core/ava/ava-core-v2
git pull
pkill -f '[a]pps.core.main:app'
.venv/bin/python -m uvicorn apps.core.main:app --host 127.0.0.1 --port 8787 &
```

---

## Common problems

**Build failed on Vercel.** Open the deployment, read the red line. Most often a
missing comma or quote in `content.json`. The live site is unaffected — fix and
commit again.

**Site loads but says HOST OFFLINE.** Ava's machine is off, or the tunnel is
down. Check `https://ava-origin.rootmc.net/api/status` directly.

---

## Subscribe to Ava's report DMs

Anyone can get the public reports in a private message. This is **not** the
developer/operator feed (no overnight status, no D1, no #development).

**Telegram:** DM Ava's bot, then send `/subscribe`. `/unsubscribe` to stop.

**Discord:** DM Ava, or type `!subscribe` in a RootMC channel she watches.
`!unsubscribe` to stop.

What they receive:

- Morning summary (10:05 HST)
- Solar + weather when it changes
- Kīlauea when it changes
- Severe/extreme NWS alerts

**Changed a file but nothing happened.** Confirm you committed to `master`, and
that the file is under the project's root directory (`packages/web/<site>/`).
