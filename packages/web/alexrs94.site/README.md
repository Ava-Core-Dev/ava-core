# alexrs94.site

Public personal site foundation for Alex.

## Pages

- `/` home
- `/solar` solar operations foundation
- `/media` photography + drone media foundation

## Local dev

```bash
cd /home/ava-core/ava/ava-core-v2/packages/web/alexrs94.site
npm install
npm run dev
```

## Deploy

Vercel primary hosting is expected for this site.

Cloudflare Pages backup can use:

```bash
bash /home/ava-core/ava/ava-core-v2/scripts/deploy-next-to-pages.sh \
  /home/ava-core/ava/ava-core-v2/packages/web/alexrs94.site alexrs94-site
```

