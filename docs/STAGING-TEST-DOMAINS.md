# Staging test.* domains

Use these hosts to preview Emergent (or any) site rebuilds **before** touching production.

| Staging URL | Pages project | Production |
|-------------|---------------|------------|
| https://test.avaivy.cloud | `avaivy-cloud-test` | avaivy.cloud → `avaivy-cloud` |
| https://test.alexrs94.site | `alexrs94-site-test` | alexrs94.site → `alexrs94-site` |
| https://test.rootrecord.online | `rootrecord-online-test` | rootrecord.online → `rootrecord-online` |
| https://test.rootmc.net | `rootmc-web-test` | rootmc.net → `rootmc-web` |
| https://test.rootrecord.info | `rootrecord-info-test` | rootrecord.info → `rootrecord-website` |

## Deploy a preview

```bash
# Next sites (from ava-core-v2)
source <(grep -E '^(CLOUDFLARE_EMAIL|CLOUDFLARE_API_KEY|CLOUDFLARE_ACCOUNT_ID)=' .env | sed 's/^/export /')
bash scripts/deploy-next-to-pages.sh packages/web/avaivy.cloud avaivy-cloud-test
bash scripts/deploy-next-to-pages.sh packages/web/alexrs94.site alexrs94-site-test
bash scripts/deploy-next-to-pages.sh packages/web/rootrecord.online rootrecord-online-test

# RootMC
npx wrangler pages deploy workstations/rootmc-web/rootmc-web/build --project-name rootmc-web-test --branch main

# rootrecord.info static
# (use Root Record CF account credentials)
npx wrangler pages deploy /home/ava-core/ava/workstations/projects/rootrecord-info-site/public \
  --project-name rootrecord-info-test --branch main
```

## Promote to production

Only after visual QA on `test.*`, deploy the same build artifact to the production project names (without `-test`).

## GitHub auto-push during Emergent

Turn **OFF** so Emergent commits are not auto-overwritten:

- Desk UI: http://127.0.0.1:8787/ops → **Turn OFF auto-push**
- CLI: `bash scripts/github-auto-push-toggle.sh off`  
- Re-enable: `bash scripts/github-auto-push-toggle.sh on`
