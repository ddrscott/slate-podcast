# Schedule the reminder cron

Slate emails Speakers 48h and 24h before their slot, but doesn't trigger itself. You need an external scheduler to POST `/api/cron/reminders` hourly.

The endpoint is idempotent: duplicate calls within the same hour are deduped via the `sent_reminders` table, so over-triggering is safe.

## Pick one

### Option A — cron-job.org (free, easiest)

1. Sign up at <https://cron-job.org>.
2. **Create cronjob** →
   - URL: `https://slate.ljs.app/api/cron/reminders`
   - Schedule: `0 * * * *` (every hour, on the hour)
   - Method: `POST`
   - Headers: `Authorization: Bearer <CRON_SECRET>`
3. Save. Watch the next two hours of execution logs to confirm 200s.

### Option B — Cloudflare Cron Triggers (separate Worker)

A separate tiny Worker because Slate's main Worker can't add a cron trigger without rebuilding the whole bundle. Create a new project:

```bash
mkdir slate-cron && cd slate-cron
npx wrangler init -y
```

`wrangler.toml`:

```toml
name = "slate-cron"
main = "src/index.ts"
compatibility_date = "2025-01-09"

[triggers]
crons = ["0 * * * *"]
```

`src/index.ts`:

```typescript
export default {
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await fetch('https://slate.ljs.app/api/cron/reminders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });
  },
};
interface Env { CRON_SECRET: string; }
```

```bash
npx wrangler secret put CRON_SECRET   # same value Slate has
npx wrangler deploy
```

## Verify

After the next top-of-the-hour:

```bash
npm run db:query:remote -- "SELECT count(*), reminder_kind FROM sent_reminders GROUP BY reminder_kind"
```

If you have confirmed slots within the next 24h or 48h windows and the count is non-zero, it's working.

## Test manually

```bash
curl -X POST https://slate.ljs.app/api/cron/reminders \
  -H "Authorization: Bearer <CRON_SECRET>"
# → {"ok":true,"sent":N,"skipped":M}
```
