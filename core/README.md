# Ava Ivy (`rootmc-ava`)

Discord bot for **Ava Ivy** — RootMC lead-dev + gamer girl.  
**Brain:**  
- **Discord** = always **dream state** (cloud brain + D1 / api.rootmc.net) — communal  
- **Slack + on-device** = **local Ollama organizer** (Goal B3) → escalate **Root Server** (Cursor) if unknown → **dream** if Cursor offline; lessons → `data/training/`  
- **Telegram** (`@ava_ivy_bot`) = service / outreach — same organizer+Root Server path when awake; **soft sleep** = dream-state summons (like Discord). DMs always, groups when @mentioned  
- **Web** (rootmc.net / wiki) = communal org / knowledge  
Public never names cloud vendors. Soft sleep keeps Discord+Telegram warm; `scripts/go-to-bed.mjs` is soft sleep (not a hard kill). Power-down still fully stops the tree. See `Server Handoffs/Ava Ivy/notes/LOCAL-BRAIN.md`.

**Handoff / docs / uploads / plans:**  
`Server Handoffs/Ava Ivy/` (layout-relative; override with `AVA_HANDOFF`)

## Run

**Windows**

```bat
cd "Web Files\rootmc-ava"
npm start
```

**Linux / SSH (headless)**

```bash
cd "Web Files/rootmc-ava"
./scripts/start-ava.sh
# or: sudo systemctl enable --now ava-ivy
```

See [docs/SSH-LINUX.md](docs/SSH-LINUX.md) + OptiPlex plan.

Status: http://127.0.0.1:8787/ · public when live: **https://ava.rootmc.net**  
Headless / SSH auto-skips the status window (`AVA_NO_STATUS_WINDOW=1`). Tunnel starts with Ava (`AVA_PUBLIC_TUNNEL=0` to disable).

## Transport

- Default `AVA_TRANSPORT=both` — **Gateway** for live messages/DMs; REST poller for boot, reactions, poll watcher
- `AVA_TRANSPORT=gateway` — gateway + reaction/boot poll only
- `AVA_TRANSPORT=poller` — REST-only live answers (emergency)

## Behavior

- Boot: watermark catch-up → asleep apology if pings while away → live
- Discord: dream-state reply (D1/api + wiki packs). Slack: Root Server dig → one answer
- First-contact **DM** onboarding once per player
- Attachments → `Ava Ivy/uploads/`; plans → `Ava Ivy/plans/`
- Features → proposal + vote gates; bugs → verify then fix
- Governance via `https://api.rootmc.net/api/governance/*`
- Job queue stage-only (no auto Shockbyte restart)
- Emergency stop: Alex / Melee (`emergency stop Ava`)
- Discord → always dream-state brain (`dreamBrain.mjs` + D1/api packs); Slack → Root Server; Cursor-dark / asleep → dream failover on Slack too
- Ops force: `AVA_FORCE_DREAM=1`

## Env (RootMC `.env`)

| Key | Role |
|-----|------|
| `AVA_DISCORD_BOT_TOKEN` | Bot token |
| `AVA_DISCORD_APPLICATION_ID` | App id `1532751879875072070` |
| `CURSOR_API_KEY` | Root Server |
| `AVA_HANDOFF` | Handoff folder |
| `AVA_WATCH_CHANNELS` | Extra channel ids (csv) |
| `AVA_AUDIT_CHANNEL_ID` | Audit posts (default admins) |
| `AVA_OFFLINE_CHANNEL_ID` | Offline notes channel |
| `AVA_TRANSPORT` | `both` / `gateway` / `poller` |
| `AVA_MEMBER_ROLE_IDS` | Discord role ids → unlimited assists |
| `AVA_MELEE_DISCORD_ID` | Melee emergency-stop Discord id |
| `AVA_RCON_HOST` / `PASSWORD` / `PORT` | Guarded RCON |
| `AVA_SLACK_BOT_TOKEN` | **Required for Ava Slack voice** (`xoxb-…`). Never post Ava via Cursor Slack MCP (that is the human login). Use `src/avaPost.mjs` or `scripts/post-as-ava.mjs`. |
| `AVA_SLACK_APP_TOKEN` | Socket Mode `xapp-…` with `connections:write`. If missing, Ava falls back to **REST poll** of `AVA_SLACK_WATCH_CHANNELS` every ~5s. |
| `AVA_TELEGRAM_BOT_TOKEN` | BotFather token for `@ava_ivy_bot` — long-poll on Ava boot |
| `AVA_TELEGRAM_ENABLED` | `1` / `0` (default on when token set) |
| `AVA_TELEGRAM_OPERATOR_IDS` | Telegram user ids (csv) allowed to sleep / wake / QUIET / `/rootrestart` |
| `AVA_ECOFLOW_ACCESS_KEY` / `SECRET_KEY` / `SN` | EcoFlow Open API (HMAC). `SN` comma-separated; buckets under handoff `data/ecoflow/` |
| `AVA_ECOFLOW_BASE_URL` | Default `https://api-a.ecoflow.com` (US). EU often `https://api-e.ecoflow.com` |
| `AVA_MOD_EXECUTE` | `1` = apply Discord timeouts on mute |
| `AVA_OFFLINE_CHANNEL_ID` | Offline notes channel |
| `AVA_AUDIT_CHANNEL_ID` | Audit posts |
| `AVA_CHANGELOG_CHANNEL_ID` | Ship/stage notes |

## HTTP

- `GET /` status window
- `GET /health` · `GET /api/status`
- `POST /v1/recommend` `{ "question", "context", "authorId" }`
