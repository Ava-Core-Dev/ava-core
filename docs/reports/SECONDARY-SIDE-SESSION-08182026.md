# Secondary side session 08182026

**5-minute read** · 19 August 2026, ~04:40–04:55 HST · morning package, media paths, fail handoff

The one-line version: Ava’s morning is one sequence — catch up, one hour awake, then one 24h report. Cursor writes the words. xAI only speaks Ara. Files land in `/home/ava-core/ava/media`. If the video cannot finish (no TTS credits), the text still posts and you get a **plain** Discord + Telegram DM with the file paths so you can finish it by hand. That ping is a template. No extra model call.

This sits next to [Primary session 08182026](./PRIMARY-SESSION-08182026.md). That night was the SSD cutover. This block is the morning/broadcast side.

---

## What “morning” means

**10:00 HST** — wake, drain D1 offline pings, one Cursor catch-up. No public “I’m back.” Proposals go to Discord `1537333521389977600`.

**11:00 HST**, or **one hour after she actually woke**, whichever is later — gather the last ~24h (including the wakeup hour) and publish once. A 1:00pm wake still gets a full day at 2:00pm. She does not skip because she was late.

Order: **render, then send.**

1. Cursor writes the 24h report, spoken script, and YouTube sidecar (title = MP4 filename).
2. xAI Ara TTS → MP3 in `media/audio/voice/generated`.
3. Host Python still-image converter → MP4 using `thumb-daily-broadcast.jpg`.
4. Slack / your DMs / Telegram get the text. Discord `#updates` gets text **and** MP4 together — only if the MP4 exists.

OBS / custom RTMP is **tomorrow**. Auto-stream stays off.

---

## If Ara cannot speak

xAI credits are exhausted tonight. That does not block the report.

Cursor still writes the markdown + spoken script + sidecar. Text still goes out. Public `#updates` does not get a fake clip-salad video.

Then the **poller script** (not a model) DMs you on Discord and Telegram:

```
Morning package incomplete — YYYY-MM-DD HST
Do the video by hand.

Failed:
- no mp4
- tts:…

Files:
report: /home/ava-core/ava/media/documents/reports/morning-YYYY-MM-DD.md
script: …/morning-YYYY-MM-DD-script.txt
sidecar: /home/ava-core/ava/media/video/reports/{title}.txt
handoff: …/morning-YYYY-MM-DD-handoff.md
```

Same note is on disk as the handoff file. Zero extra tokens for that ping.

---

## Media library

Canonical root: `/home/ava-core/ava/media`

| Path | Job |
|------|-----|
| `audio/voice/generated` | Live Ara / NWS / Kīlauea TTS |
| `audio/generated` | Symlink → `voice/generated` |
| `video/reports` | Titled YouTube MP4 + matching `.txt` |
| `video/current` | OBS latest, `Morning_Broadcast_Current.mp4` |
| `documents/reports` | Morning markdown, script, handoff |
| `images/thumbnails/thumb-daily-broadcast.jpg` | Morning still |

Python converter: `apps.core.mp4_converter`. Node shells out; ffmpeg in Node is only fallback. Convert was smoke-tested. Hurricane Lala’s ~5 GB dump stayed in the archive.

Portraits, brand icon, both thumbs, station ID, and `ava-good-morning.mp4` are on this disk.

---

## Who spends tokens

| Job | Who |
|-----|-----|
| Report, script, YouTube SEO pack | **Cursor first** (`grok-4.6` in Cursor, then `composer-2.5`) |
| Ara MP3 | **xAI TTS only** |
| xAI chat API | Last resort if Cursor cannot run |
| Fail DM / handoff | **No model** — fixed template after generate |

Public posts still must not name vendors. Live chat is still the Node poller in `ava-old-20260819/core`. It booted before this block; **restart it** to load the new morning path.

---

## What you still have to do

1. Restart the Discord poller.
2. Add xAI credits when you want Ara audio again — words already come from Cursor.
3. OBS / RTMP tomorrow. Do not enable auto-stream tonight.
4. Primary leftovers: Vercel Owner import, `rootmc.info` in the new Cloudflare account, APK/JAR rebuilds.

That is the side session. Same SSD, one morning package, a dumb fail ping instead of another brain.
