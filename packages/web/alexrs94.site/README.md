# alexrs94.site

Public personal site foundation for Alex.

## Pages

- `/` home
- `/solar` solar operations foundation
- `/media` photography + drone media foundation
- `/blog` personal blog (markdown in `media/documents/reports/posts/alex/`)

## Blog

Edit markdown under `/home/ava-core/ava/media/documents/reports/posts/alex/`, then:

```bash
python3 /home/ava-core/ava/ava-core-v2/scripts/sync-blogs.py
```

That regenerates `src/lib/blogPosts.ts`. GitHub auto-push deploys to Vercel when connected.

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

