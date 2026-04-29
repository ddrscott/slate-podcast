# Environment, secrets, and bindings

## Bindings (`wrangler.toml`)

| Binding | Type | Purpose |
|---|---|---|
| `DB` | D1 (`slate-podcast`) | All persistent data. `remote = true` ⇒ even local `npm run dev` hits the production DB. |
| `MEDIA` | R2 (`slate-media`) | User uploads (headshots, slot promo images, eventually audio). Served through `/media/<key>`. |
| `ASSETS` | Static assets | Auto-bound by `@astrojs/cloudflare` to `./dist` |

## Public vars (`wrangler.toml [vars]`)

These are baked in at build time and visible to anyone with the worker bundle.

| Var | Default | Purpose |
|---|---|---|
| `APP_BASE_URL` | `https://slate.ljs.app` | Used in email links and absolute URLs |
| `AUTH_BASE_URL` | `https://auth.ljs.app` | Where the sign-in flow redirects |
| `PLAUSIBLE_HOST` | `plausible.ljs.app` | Plausible Analytics endpoint |

## Secrets (`wrangler secret put`)

Set per environment. Values are encrypted at rest in Cloudflare.

| Secret | Purpose | Source of truth |
|---|---|---|
| `JWT_SECRET` | HMAC key Slate uses to verify `auth.ljs.app`'s session JWTs | `auth.ljs.app`'s own `JWT_SECRET` — must match exactly |
| `RESEND_API_KEY` | Reminder email delivery | resend.com (same account as auth.ljs.app) |
| `RESEND_FROM` | `From:` header | e.g. `Slate <hello@ljs.app>` (reuses verified `ljs.app` domain) |
| `CRON_SECRET` | Bearer token required by `/api/cron/reminders` | Any random string; `openssl rand -hex 32` is fine |

Set them all at once:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM
npx wrangler secret put CRON_SECRET
```

## Local equivalents (`.dev.vars`)

```
JWT_SECRET=<paste from auth.ljs.app>
RESEND_API_KEY=re_xxx_local_only
RESEND_FROM=Slate <hello@ljs.app>
CRON_SECRET=dev-only-cron-secret
```

`.dev.vars` is git-ignored. The `.dev.vars.example` template is checked in.

In dev:
- A placeholder `RESEND_API_KEY` is fine — `src/lib/email.ts` logs the email to the console instead of sending when the key looks fake.
- `CRON_SECRET` only matters if you're hitting `/api/cron/reminders` locally.

## Environment type (`Env`)

Augmented in `src/env.d.ts`:

```typescript
interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  APP_BASE_URL: string;
  AUTH_BASE_URL: string;
  PLAUSIBLE_HOST: string;
  JWT_SECRET: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  CRON_SECRET: string;
}
```

Auto-generate after editing `wrangler.toml`:

```bash
npx wrangler types
```
