# Voice Clips Needed — Recording Manifest
_Generated Aug 19, 2026. All clips are Ara voice, same tone/pace as existing library._
_Save as MP3, ~22kHz, mono. Match loudness of existing clips._

---

## Numbers — `data/voice/numbers/<n>.mp3`

Missing from 0–100 range and solar/battery magnitudes:

| Clip | Say |
|------|-----|
| `0.mp3` | "zero" |
| `150.mp3` | "one fifty" |
| `200.mp3` | "two hundred" |
| `250.mp3` | "two fifty" |
| `300.mp3` | "three hundred" |
| `400.mp3` | "four hundred" |
| `500.mp3` | "five hundred" |
| `600.mp3` | "six hundred" |
| `700.mp3` | "seven hundred" |
| `800.mp3` | "eight hundred" |
| `900.mp3` | "nine hundred" |
| `1000.mp3` | "one thousand" |
| `1200.mp3` | "twelve hundred" |
| `1500.mp3` | "fifteen hundred" |
| `2000.mp3` | "two thousand" |

---

## Alert Levels — `data/voice/words/<word>.mp3`

Needed for Kīlauea / NOAA alert announcements:

| Clip | Say |
|------|-----|
| `advisory.mp3` | "advisory" |
| `watch.mp3` | "watch" |
| `warning.mp3` | "warning" |
| `alert.mp3` | "alert" |
| `elevated.mp3` | "elevated" |
| `eruption.mp3` | "eruption" |
| `erupting.mp3` | "erupting" |
| `kilauea.mp3` | "Kīlauea" |
| `volcanic.mp3` | "volcanic" |
| `lava.mp3` | "lava" |
| `quake.mp3` | "quake" |
| `earthquake.mp3` | "earthquake" |
| `magnitude.mp3` | "magnitude" |

---

## Months — `data/voice/words/<month>.mp3`

| Clip | Say |
|------|-----|
| `january.mp3` | "January" |
| `february.mp3` | "February" |
| `march.mp3` | "March" |
| `april.mp3` | "April" |
| `may.mp3` | "May" |
| `june.mp3` | "June" |
| `july.mp3` | "July" |
| `september.mp3` | "September" |
| `october.mp3` | "October" |
| `november.mp3` | "November" |
| `december.mp3` | "December" |

_(august.mp3 already exists)_

---

## System Status — `data/voice/words/<word>.mp3`

| Clip | Say |
|------|-----|
| `charging.mp3` | "charging" |
| `discharging.mp3` | "discharging" |
| `standby.mp3` | "standby" |
| `idle.mp3` | "idle" |
| `active.mp3` | "active" |
| `running.mp3` | "running" |
| `stable.mp3` | "stable" |
| `critical.mp3` | "critical" |
| `nominal.mp3` | "nominal" |
| `degraded.mp3` | "degraded" |
| `second.mp3` | "second" |
| `seconds.mp3` | "seconds" |
| `midnight.mp3` | "midnight" |

---

## Economy / Multiplier — `data/voice/words/<word>.mp3`

| Clip | Say |
|------|-----|
| `multiplier.mp3` | "multiplier" |
| `times.mp3` | "times" |
| `economy.mp3` | "economy" |
| `players.mp3` | "players" |
| `connected.mp3` | "connected" |

---

## Server Ops — `data/voice/words/<word>.mp3`

| Clip | Say |
|------|-----|
| `server.mp3` | "server" |
| `restarting.mp3` | "restarting" |
| `backup.mp3` | "backup" |
| `report.mp3` | "report" |
| `daily.mp3` | "daily" |
| `weekly.mp3` | "weekly" |
| `update.mp3` | "update" |

---

## Phrase Clips (optional, higher priority) — `data/voice/words/phrase_<name>.mp3`

These are full sentences Ara says as a unit — faster than building from words, smoother output:

| Clip | Say |
|------|-----|
| `phrase_kilauea_advisory.mp3` | "Kīlauea is at advisory level. Economy multiplier is now active." |
| `phrase_kilauea_watch.mp3` | "Kīlauea is at watch level. Economy multiplier increased." |
| `phrase_kilauea_eruption.mp3` | "Kīlauea is erupting. Maximum economy multiplier is now active." |
| `phrase_kilauea_normal.mp3` | "Kīlauea activity has returned to normal." |
| `phrase_all_systems_running.mp3` | "All systems running. Relaying data." |
| `phrase_device_startup.mp3` | "Root Record is online. I'm back." |
| `phrase_late_night.mp3` | "Late night status check. Still running." |
| `phrase_server_online.mp3` | "RootMC server is online." |
| `phrase_server_offline.mp3` | "RootMC server is offline." |
| `phrase_economy_multiplier_x2.mp3` | "Economy multiplier is now two times." |
| `phrase_economy_multiplier_x2_5.mp3` | "Economy multiplier is now two point five times." |
| `phrase_economy_multiplier_x3.mp3` | "Economy multiplier is now three times." |
| `phrase_economy_normal.mp3` | "Economy multiplier is back to normal." |

---

## Time Clips — `data/voice/time_clips/time_<HHMM>.mp3`

Currently have: 0000–2330 in 30-min steps (48 clips) ✓ — **complete, nothing needed here.**

---

## Priority Order

1. **Alert levels** (kilauea, eruption, advisory, watch, warning) — live ops
2. **Phrase clips** — smoothest speech output without API calls
3. **Months** — date announcements
4. **System status** (charging, stable, critical, nominal)
5. **Economy/multiplier** words
6. **Numbers** (0, 150–2000) — solar/battery values
7. **Server ops** words
