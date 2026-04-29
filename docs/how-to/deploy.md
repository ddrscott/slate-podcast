# Deploy to `slate.ljs.app`

Use this for the first-time deploy of a new Slate environment, or to refresh production after a fresh `wrangler.toml`.

If you only want to push code to an already-set-up environment, run `npm run deploy`.

## 1. Log in to Cloudflare

```bash
npx wrangler login
```

## 2. Create the D1 database

```bash
npx wrangler d1 create slate-podcast
```

Output includes a `database_id`. Paste it into `wrangler.toml` under `[[d1_databases]]`, replacing whatever's there.

## 3. Apply the schema

```bash
npm run db:apply:remote
```

Schema is idempotent (uses `CREATE TABLE IF NOT EXISTS`); safe to re-run after additions.

## 4. Set production secrets

```bash
npx wrangler secret put JWT_SECRET         # MUST equal auth.ljs.app's JWT_SECRET
npx wrangler secret put RESEND_API_KEY     # from resend.com
npx wrangler secret put RESEND_FROM        # e.g. "Slate <hello@ljs.app>"
npx wrangler secret put CRON_SECRET        # any random string (e.g. `openssl rand -hex 32`)
```

`RESEND_FROM` reuses the verified `ljs.app` domain — no separate domain registration needed.

## 5. Create the R2 bucket

```bash
npx wrangler r2 bucket create slate-media
```

The `MEDIA` binding in `wrangler.toml` already points at this name; nothing to edit.

## 6. Deploy

```bash
npm run deploy
```

This runs `astro build`, writes `_worker.js` and `_routes.json` to `dist/`, then `wrangler deploy`s.

## 7. Set up the reminder cron

The cron endpoint is built in but isn't triggered by Slate itself. See **[How-to: schedule the reminder cron](schedule-reminder-cron.md)**.

## 8. Verify

```bash
curl -s https://slate.ljs.app/ -o /dev/null -w "%{http_code}\n"   # → 200
npm run db:query:remote -- "SELECT name FROM slates LIMIT 5"
```

Sign in via `https://slate.ljs.app/me`. If you land on `/me` with your email shown, you're live.
