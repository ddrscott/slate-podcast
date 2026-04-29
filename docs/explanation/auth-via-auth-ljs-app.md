# Why auth lives at `auth.ljs.app`, not in Slate

Slate doesn't have a sign-in page, a magic-link table, a password column, or even its own session storage. Authentication is fully delegated to a separate Worker at `auth.ljs.app`.

## How it works

1. User clicks **Sign in** anywhere in Slate.
2. Slate redirects to `https://auth.ljs.app/login?returnTo=https://slate.ljs.app/api/auth/callback?next=...`
3. `auth.ljs.app` collects the email, sends a magic link from `hello@ljs.app` (Resend).
4. User clicks the magic link. `auth.ljs.app` validates the token, mints a session JWT, and redirects to the `returnTo` URL with `&token=<jwt>` appended.
5. Slate's `/api/auth/callback` verifies the JWT's HMAC signature using its own `JWT_SECRET` (which is the same value as auth.ljs.app's), sets a session cookie, and 302s to `next`.

The JWT format is opaque-ish: `base64({ data: JSON.stringify(payload), sig: hex(HMAC) })`. Verification is in `src/lib/auth.ts:verifySessionToken`.

## What Slate stores

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,        -- the auth.ljs.app userId
  email TEXT UNIQUE NOT NULL,
  headshot_url TEXT
);
```

That's it. No `password_hash`, no `magic_link_tokens`, no `sessions`. The first time a user signs in, `ensureUserRow()` does an `INSERT ... ON CONFLICT DO UPDATE` keyed on the auth.ljs.app userId.

## Why this is good

- **One sign-in across all `*.ljs.app` apps.** A user signing in to `life.ljs.app` is signed in to Slate too — same cookie domain, same JWT.
- **No Resend domain juggling per app.** Magic links always come from `hello@ljs.app`. We don't have to verify `slate.ljs.app` (or any future subdomain) as a sender domain — verification is per *base domain*, not subdomain, but the SES/Resend convention is to use a clean shared sender.
- **Slate stays small.** No magic-link expiry job, no rate-limiting login attempts, no password reset flow, no email-change verification. All the auth surface area lives in one place.
- **Stateless verification.** Slate verifies tokens with a shared HMAC key. No round-trip to auth.ljs.app on every request.

## What we give up

- **A coupled deploy.** If `auth.ljs.app` is down, Slate sign-in is down. Existing sessions still work (JWT TTL is 30 days), so the blast radius is bounded.
- **Rotating `JWT_SECRET`.** A rotation is a coordinated 2-system deploy: change auth.ljs.app's secret first, then Slate's. Old sessions are invalidated. We've never done it; we'd plan it.
- **Scope changes need re-sign-in.** Scopes (`admin`, `slate:admin`) are baked into the JWT at issuance. Promoting someone to App-Admin requires them to sign out and in to pick up the new scope.

## Why HMAC, not RSA / asymmetric

Both apps live in the same trust boundary (same Cloudflare account, same humans). Symmetric HMAC is simpler and faster, and we don't need the asymmetric property "anyone can verify, only one party can sign" — Slate is the only consumer.

If a third app outside our control needed to verify tokens, we'd switch to RSA / JWKS at that point, not before.
