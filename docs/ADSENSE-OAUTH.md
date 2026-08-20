# Google AdSense OAuth — what to paste (not example.com)

`https://www.example.com/oauth2callback` is **Google’s placeholder text**. Never leave that in the form.

## Two different things

| Goal | What you need |
|------|----------------|
| **Ads on the website** (banners visitors see) | AdSense publisher / client ID + ad unit snippets / `ads.txt` on each site |
| **Ava talks to AdSense API** (accounts, reports, inventory) | OAuth client + redirect URI below → token on the desk |

This doc is for **Ava ↔ AdSense API**.

## Authorized redirect URIs (paste these)

In [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → your OAuth 2.0 Client:

**Application type:** Web application (recommended for our HTTPS tunnel)

**Authorized redirect URIs** — add all of these:

```text
https://ava-origin.rootmc.net/api/ops/adsense/oauth/callback
http://127.0.0.1:8787/api/ops/adsense/oauth/callback
http://localhost:8787/api/ops/adsense/oauth/callback
```

Optional (local tools / Playground):

```text
http://localhost:8080/
http://127.0.0.1:8080/
```

**Authorized JavaScript origins** (if the form asks):

```text
https://ava-origin.rootmc.net
https://avaivy.cloud
http://127.0.0.1:8787
```

Save. Wait ~1–5 minutes for Google to propagate.

## Connect Ava

1. Enable **AdSense Management API** on the same Google Cloud project.
2. Open http://127.0.0.1:8787/ops → **Connect AdSense (browser)**  
   (or open the `auth_url` from `GET http://127.0.0.1:8787/api/ops/adsense/status`).
3. Sign in with the Google account that owns AdSense.
4. You should land on a “AdSense connected” page; token is saved under `data/secrets/google-adsense-token.json` (never git).
5. On `/ops`, click **List accounts** to confirm Ava can call the API.

## If Google still rejects the redirect

- URI must match **exactly** (https vs http, trailing slash, path).
- Do not use `https://avaivy.cloud/...` unless that path proxies to Core — use **`ava-origin.rootmc.net`** (tunnel → desk `:8787`).
- Client ID in Console must be the same as on the desk (`366072724921-baueoiiimj6rramekk6q7c3uq8k9pl5s…`).

## Automate reports (boot + EOD)

Ava posts AdSense snapshots **twice per day** to Discord `#automations`:

| When | Trigger |
|------|---------|
| **Boot** | When Core starts (`uvicorn` / Desktop) — 30 min flap cooldown |
| **End of day** | **21:00 HST** cron `adsense-eod` |

Reports land in `reports/adsense-{boot|eod|manual}-YYYY-MM-DD.md` and Discord.

Manual: http://127.0.0.1:8787/ops → **Run report now**  
or `POST /api/ops/adsense/report?kind=manual`

Until OAuth is connected, posts say to connect from `/ops` (no crash).

## Site ads (separate from API)

Publisher snippets go in each site’s layout (e.g. `ca-pub-…`). That does **not** replace OAuth; OAuth is how Ava reads/manages AdSense from the desk.

