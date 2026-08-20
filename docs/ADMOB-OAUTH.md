# Google AdMob OAuth + Ava reports (same client as AdSense)

Reuse this OAuth client (already on the desk):

```text
366072724921-baueoiiimj6rramekk6q7c3uq8k9pl5s.apps.googleusercontent.com
```

`https://www.example.com/oauth2callback` is **Google’s placeholder** — never leave that in the form.

## AdSense vs AdMob

| Product | Where ads run | Ava API |
|---------|---------------|---------|
| **AdSense** | Websites (avaivy.cloud, etc.) | AdSense Management API |
| **AdMob** | Mobile apps (Android / iOS) | AdMob API |

Same Google Cloud **project** + same **OAuth client ID** can serve both. You add **AdMob scopes** and a **separate redirect URI**, then connect once for AdMob (token file is separate from AdSense).

---

## 1. Google Cloud Console (one-time)

Open [Google Cloud Console](https://console.cloud.google.com/) → the project that owns client  
`366072724921-baueoiiimj6rramekk6q7c3uq8k9pl5s…`

### A. Enable the API

**APIs & Services → Library →** enable **AdMob API**.

### B. OAuth consent screen

**APIs & Services → OAuth consent screen → Edit app → Scopes → Add scopes:**

```text
https://www.googleapis.com/auth/admob.readonly
```

(Optional report-only scope: `https://www.googleapis.com/auth/admob.report` — readonly is enough.)

If the app is in **Testing**, add your Google account under **Test users**.

### C. Credentials — same Web client

**APIs & Services → Credentials →** open the OAuth client  
`366072724921-baueoiiimj6rramekk6q7c3uq8k9pl5s.apps.googleusercontent.com`

**Authorized redirect URIs** — keep the AdSense ones, and **add**:

```text
https://ava-origin.rootmc.net/api/ops/admob/oauth/callback
http://127.0.0.1:8787/api/ops/admob/oauth/callback
http://localhost:8787/api/ops/admob/oauth/callback
```

Full set for this desk (AdSense + AdMob):

```text
https://ava-origin.rootmc.net/api/ops/adsense/oauth/callback
http://127.0.0.1:8787/api/ops/adsense/oauth/callback
http://localhost:8787/api/ops/adsense/oauth/callback
https://ava-origin.rootmc.net/api/ops/admob/oauth/callback
http://127.0.0.1:8787/api/ops/admob/oauth/callback
http://localhost:8787/api/ops/admob/oauth/callback
http://localhost:8080/
http://127.0.0.1:8080/
```

**Authorized JavaScript origins** (unchanged):

```text
https://ava-origin.rootmc.net
https://avaivy.cloud
http://127.0.0.1:8787
```

Save. Wait 1–5 minutes.

---

## 2. AdMob publisher account

1. Sign in at [https://admob.google.com](https://admob.google.com) with the **same Google account** you’ll OAuth.
2. Note your publisher ID: `pub-XXXXXXXXXXXXXXXX` (Account → Account information).
3. Optional desk override in `.env`:

```bash
GOOGLE_ADMOB_ACCOUNT_NAME=accounts/pub-XXXXXXXXXXXXXXXX
```

If unset, Ava lists `GET https://admob.googleapis.com/v1/accounts` and uses the first account.

---

## 3. Connect Ava (desk)

1. Open http://127.0.0.1:8787/ops  
2. Under **Google AdMob API** → **Connect AdMob (browser)**  
3. Approve AdMob access (Google may ask again even if AdSense was already connected — that’s normal; scopes differ).  
4. You should see **AdMob connected**. Token path (never git):

```text
ava-core-v2/data/secrets/google-admob-token.json
```

5. Click **List AdMob accounts**, then **Run AdMob report now**.

CLI / API:

```bash
curl -sS http://127.0.0.1:8787/api/ops/admob/status | jq .
curl -sS -X POST 'http://127.0.0.1:8787/api/ops/admob/report?kind=manual' | jq .
```

---

## 4. Automation (same cadence as AdSense)

| When | Trigger |
|------|---------|
| **Boot** | Core start (~12s later, 30 min flap cooldown) |
| **End of day** | **21:05 HST** cron `admob-eod` (5 min after AdSense EOD) |

Posts → Discord `#automations` (`1535712809399361668`).  
Files → `media/documents/reports/admob-{boot|eod|manual}-YYYY-MM-DD.md`.

---

## 5. Checklist

- [ ] AdMob API enabled on the Cloud project  
- [ ] Scope `admob.readonly` on the consent screen  
- [ ] Redirect URIs include `…/api/ops/admob/oauth/callback` (not example.com)  
- [ ] Client ID matches `366072724921-baueoiiimj6rramekk6q7c3uq8k9pl5s…`  
- [ ] Connected from `/ops` → token file exists  
- [ ] Manual report posts to Discord  

## Common failures

| Symptom | Fix |
|---------|-----|
| redirect_uri_mismatch | Paste exact AdMob callback URIs above; wait a few minutes |
| access_denied / app not verified | Add yourself as Test user; or publish app |
| 403 AdMob API | Enable **AdMob API** on the project |
| Empty accounts | OAuth Google account must own the AdMob publisher |
| Still sees AdSense-only token | Use **Connect AdMob** (separate token file), not AdSense |

## App ads (separate from API)

SDK / app-id / ad-unit IDs in the Android/iOS apps are **not** this OAuth flow. This flow is only so Ava can **read AdMob network reports** on boot and at EOD close.
