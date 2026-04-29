# Setting up Slate for local development

By the end of this you'll have a Slate dev server running on `http://localhost:4321`, signed in as yourself, talking to the production D1 database.

> **Heads up — dev hits production data.** `wrangler.toml` sets `remote = true` on the D1 binding, so `npm run dev` reads and writes the live `slate-podcast` database. There is no local SQLite emulator in this setup. If you want isolation, see [How-to: switch dev to a local D1 emulator](../how-to/switch-dev-to-local-d1.md).

You'll need:

- Node 20+.
- A Cloudflare account with access to the `slate-podcast` Workers project.
- Access to the `auth.ljs.app` Workers project (for `JWT_SECRET`).
- `wrangler` (installed via `npm install` below).

## 1. Clone and install

```bash
git clone https://github.com/<your-org>/slate-podcast
cd slate-podcast
npm install
```

## 2. Log in to Cloudflare

```bash
npx wrangler login
```

Browser opens, you authorize. Done.

## 3. Pull the JWT secret from auth.ljs.app

`JWT_SECRET` must match `auth.ljs.app`'s JWT secret exactly — Slate verifies tokens issued there using this shared HMAC key.

```bash
cd ~/code/auth.ljs.app
npx wrangler secret list           # confirm a JWT_SECRET exists
# the value isn't displayed — pull from your password manager
cd -
```

If you don't have it stored, the value is in 1Password under "auth.ljs.app secrets".

## 4. Create `.dev.vars`

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:

```
JWT_SECRET=<the value from step 3>
RESEND_API_KEY=re_xxx_local_only
RESEND_FROM=Slate <hello@ljs.app>
CRON_SECRET=dev-only-cron-secret
```

`RESEND_API_KEY` is a placeholder in dev — reminder emails log to the dev console instead of being sent. Don't use a real key locally unless you want to spam yourself.

## 5. Run the dev server

```bash
npm run dev
```

Astro starts on `http://localhost:4321`. The Cloudflare runtime (`locals.runtime.env`) is available because `@astrojs/cloudflare` is the adapter.

## 6. Sign in as yourself

1. Open `http://localhost:4321`.
2. Click **Sign in**.
3. You'll be redirected to `https://auth.ljs.app/login` (production), enter your email.
4. The magic link comes from `hello@ljs.app`. Click it.
5. The link redirects back to `http://localhost:4321/api/auth/callback?next=...&token=<jwt>`. The callback sets your session cookie and lands you on `/me`.

`localhost` is whitelisted by `auth.ljs.app`'s `returnTo` validator, so this flow works without any extra config.

## 7. Sanity-check

```bash
npm run typecheck
npm run db:query:remote -- "SELECT count(*) FROM slates"
```

If both succeed, you're set up.

## What's next

- **[Reference: project layout](../reference/project-layout.md)** — what's where in `src/`.
- **[Reference: npm scripts](../reference/npm-scripts.md)** — every script in `package.json`, what it does.
- **[How-to: deploy to slate.ljs.app](../how-to/deploy.md)** — when you're ready to ship.
