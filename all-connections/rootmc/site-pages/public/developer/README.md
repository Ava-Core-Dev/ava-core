# Developer portal

Paths under `/developer/` on the `rootmc-web` Pages project.

| URL | Role |
|---|---|
| `/developer/` | Portal home + session status |
| `/developer/keys/` | My Keys — generate / delete account keys |
| `/developer/servers/` | My Servers — license presence health per linked server |
| `/developer/servers/manage/?id=` | Per-server management — health, rename, mesh opt-in, unlink |
| `/developer/register/` | Discord registration |
| `/developer/login/` | Discord sign-in (same OAuth; creates account if new) |

**Custom domain:** attach `developer.rootmc.net` to Pages project `rootmc-web` (same deploy as rootmc.net). Open `/developer/` on that host until a host-root rewrite is added.

**Install path (primary):** generate a key → put `server-name` + `product-key` in `plugins/RootMC/root-core.yml` → start Root-Core → bind/presence registers the server on My Servers. Manual “cloud.yml” mint is an override only.

**API** (deploy `Web Files/rootmc-api/deploy.ps1`):

- `POST /api/developer/auth/discord/start` — `{ return_to: "/developer/" }`
- `GET /api/developer/me` — session, account keys (masked), linked servers
- `GET /api/developer/servers` — owned servers with license presence health (online ≤10m / degraded ≤1h / offline)
- `GET /api/developer/servers/:id` — one owned server with health
- `POST /api/developer/servers/rename` — `{ server_id, server_name }` portal label
- `POST /api/developer/servers/unlink` — remove portal row (key unchanged; Paper can re-bind)
- `POST /api/developer/servers/mesh` — `{ server_id, enabled, address? }` transfer-mesh opt-in (host:port)
- `GET /api/rootmc/transfer-mesh` — server-auth peer list for Root-Core `/goto`
- `POST /api/developer/keys` — mint free account key (plaintext once)
- `POST /api/developer/keys/delete` — soft-revoke account key
- `POST /api/developer/servers` — manual cloud.yml override `{ server_name, product_key_id? }` → `server_id` + `server_secret` once
- `POST /api/rootmc/license/bind` — Root-Core product-key bind
- `POST /api/rootmc/license/presence` — Root-Core product-key presence (My Servers)
- `POST /api/developer/auth/logout`

OAuth callback reuses `https://api.rootmc.info/v1/discord/rootmc/callback` with state prefix `register:`.
