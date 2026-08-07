# Ava Ivy Slack app (one-time)

Official short/long copy: `Server Handoffs/Ava Ivy/docs/slack-app-copy.md` (also locked in lead-dev notes).

1. Open https://api.slack.com/apps → **Create New App** → **From a manifest**
2. Pick workspace **RootMC** (`rootmcworkspace`)
3. Paste [`slack-app-manifest.json`](../slack-app-manifest.json)
4. **Install to Workspace** (prefer dashboard OAuth page over raw authorize links)
5. **Socket Mode** → enable → generate **App-Level Token** with scope `connections:write` → copy `xapp-…`
6. **OAuth & Permissions** → copy **Bot User OAuth Token** `xoxb-…`
7. Put into `D:\.1 Work Stations\RootMC\.env`:

```
AVA_SLACK_BOT_TOKEN=xoxb-...
AVA_SLACK_APP_TOKEN=xapp-...
AVA_SLACK_WATCH_CHANNELS=C0BMCPMDDQR,C0BM4P3GVDX
AVA_SLACK_OPERATOR_IDS=U0BLWBTGYTU,U0BLQ5Q8WTD
```

8. In Slack, invite `@Ava Ivy` to `#development-feed` and `#new-plugin-development-plans`
9. Restart Ava (`npm start` in `Web Files/rootmc-ava`)
