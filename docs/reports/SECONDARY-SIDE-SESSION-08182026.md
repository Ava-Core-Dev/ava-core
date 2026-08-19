# Secondary side session 08182026

**5-minute read** · 19 August 2026, ~04:40–04:52 HST · morning package + media paths

The one-line version: Ava’s morning is one sequence now — catch up, one hour awake, then a full 24h report with Ara audio and a titled YouTube MP4. Cursor writes the words (Grok-in-Cursor when it can). xAI is only for Ara’s voice. Files land in the media library, not `data/generated`.

This sits next to [Primary session 08182026](./PRIMARY-SESSION-08182026.md). That night was the SSD cutover. This block is the morning/broadcast side.

---

## What “morning” means

10:00 HST she wakes and does D1 offline-ping sync plus one Cursor catch-up. No public “I’m back” dump. Proposals go to Discord `1537333521389977600`.

11:00 HST — or **one hour after she actually woke**, whichever is later — she gathers the last ~24h (including the wakeup hour) and publishes **one** report. A 1:00pm wake still gets a full day at 2:00pm. She does not skip the report because she was late.

Publish order is render first, then send:

1. Cursor writes the report, spoken script, and YouTube sidecar
2. xAI Ara TTS → MP3
3. Host Python still-image converter → MP4 (daily broadcast thumbnail)
4. Then Slack / Alex / Telegram get the text; Discord `#updates` gets the report **and** the MP4 together

If Ara TTS is out of credits, the text still goes out. She will not fake a clip-salad “voice” video.

OBS / custom RTMP is still **tomorrow**. Auto-stream stays off.

---

## Media library (where the files go)

Canonical root: `/home/ava-core/ava/media`

| Path | Job |
|------|-----|
| `audio/voice/generated` | Live Ara / NWS / Kīlauea TTS MP3s |
| `audio/generated` | Symlink → `voice/generated` (old writers keep working) |
| `video/reports` | Titled YouTube morning MP4 + matching `.txt` sidecar (title = filename) |
| `video/current` | OBS latest, including `Morning_Broadcast_Current.mp4` |
| `images/thumbnails/thumb-daily-broadcast.jpg` | Still used for the morning MP4 |

Python `GENERATED_DIR` and `MP4_DIR` point at those folders. The Node poller shells out to `apps.core.mp4_converter` and `apps.core.broadcast_render`; ffmpeg in Node is only a fallback. A still+audio convert was smoke-tested through both paths.

Hurricane Lala’s ~5 GB dump stays in the archive. It was not copied.

A quick live check of the staged portraits, brand icon, default + daily thumbs, station ID, and `ava-good-morning.mp4` all **HAVE** on this disk. An archive `find` for extras was aborted after it hung; nothing was missing from that short list.

---

## Brains (no xAI credits for chat)

xAI credits are exhausted. That does **not** block the morning words.

| Job | Who |
|-----|-----|
| 24h report, spoken script, YouTube title / SEO / GEO / sidecar | **Cursor first** (`grok-4.6` in Cursor, then `composer-2.5` if that model ID fails) |
| Ara spoken MP3 | **xAI TTS only** (`voice_id=ara`) |
| xAI chat (`api.x.ai`) | Last-resort text if Cursor cannot run **and** a key still answers |

Grok-in-Cursor is billed through Cursor, not console.x.ai. Public posts still must not name vendors.

Live Discord/Slack/Telegram is still the Node poller in `ava-old-20260819/core`. These path and brain changes are in that tree. The poller that was up tonight booted **before** this block — it needs a restart to load them. Python `:8787` picks up converter/path defaults on its next start.

---

## What you still have to do (this side)

1. **Restart the Discord poller** when you want the new morning path live (not done in this session).
2. **xAI credits** when you want Ara audio again — words will already be Cursor.
3. **OBS / RTMP** tomorrow. Do not turn `OBS_AUTO_STREAM` on tonight.
4. Primary session leftovers still stand: Vercel Owner import, `rootmc.info` in the new Cloudflare account, APK/JAR rebuilds.

That is the side session. Same SSD, same media tree, morning now has a single package instead of competing dumps.
