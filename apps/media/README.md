# Ava Media Library (ava-core-v2)
PG-13 character / stream assets staged on the SSD so the archive disk is not required.

## Layout

| Path | Purpose |
|------|---------|
| `brand/` | Icons, Root Record + LavaWatchers logos |
| `portraits/` | Named Ava appearance stills |
| `thumbnails/` | YouTube / stream thumbs (`DEFAULT.jpg` = daily broadcast) |
| `emojis/discord/` | Discord emoji pack |
| `videos/clips/` | Short reaction / greeting MP4 + GIF |
| `videos/mp4-current/` | Latest weather/quake/report MP4s |
| `audio/station/` | Station ID + intro |
| `audio/reports/` | Long-form Ara report audio |
| `stream/overlays/` | OBS HTML overlays |
| `stream/obs-cams/` | OBS HUD frames |

## Defaults wired in code

- Voice MP4 thumbnail → `thumbnails/thumb-daily-broadcast.jpg` (also copied to `apps/voice/assets/thumbnail.jpg`)
- `MEDIA_DIR` / `THUMBNAIL_PATH` in `apps/core/config.py`

See `manifest.json` for per-file usage.
