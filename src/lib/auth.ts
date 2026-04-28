import type { APIContext, AstroCookies } from 'astro';
import { getDb, getEnv } from './db';

export interface AuthUser {
  id: string;        // auth.ljs.app userId (stored as-is)
  email: string;
  scopes: string[];
}

export interface SessionPayload {
  email: string;
  userId: string;
  scopes?: string[];
  gravatarHash?: string;
  exp: number;       // ms since epoch (auth.ljs.app convention)
  iat: number;
  iss: string;
}

const SESSION_COOKIE = 'session';

// ── Sign-in URL builder (called wherever we need to gate a page) ──────────
//
// Builds a redirect to auth.ljs.app/login that comes back through
// our /api/auth/callback (with `?token=<jwt>` appended by auth.ljs.app)
// and then redirects on to the `next` path inside Slate.

export function signInUrl(env: Env, origin: string, next: string): string {
  const base = env.AUTH_BASE_URL ?? 'https://auth.ljs.app';
  const callback = `${origin}/api/auth/callback?next=${encodeURIComponent(next || '/me')}`;
  return `${base}/login?returnTo=${encodeURIComponent(callback)}`;
}

export function signInUrlForCtx(ctx: APIContext | { request: Request; locals: App.Locals }, next: string): string {
  const env = (ctx.locals as App.Locals).runtime?.env as Env;
  const origin = new URL(ctx.request.url).origin;
  return signInUrl(env, origin, next);
}

// ── JWT verify (HMAC-SHA256, format issued by auth.ljs.app) ───────────────

export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  try {
    const decoded = JSON.parse(atob(token)) as { data: string; sig: string };
    const payload = JSON.parse(decoded.data) as SessionPayload;

    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    if (payload.iss !== 'auth.ljs.app') return null;
    if (typeof payload.email !== 'string' || typeof payload.userId !== 'string') return null;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sigBytes = new Uint8Array(
      (decoded.sig.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
    );
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(decoded.data));
    return valid ? payload : null;
  } catch {
    return null;
  }
}

// ── Session lookup used by middleware ─────────────────────────────────────

export async function getCurrentUser(
  ctx: APIContext | { locals: App.Locals; cookies: AstroCookies },
): Promise<{ user: AuthUser; jwt: SessionPayload } | null> {
  const cookie = ctx.cookies.get(SESSION_COOKIE);
  if (!cookie?.value) return null;

  const env = getEnv(ctx as APIContext);
  if (!env.JWT_SECRET) return null;

  const payload = await verifySessionToken(cookie.value, env.JWT_SECRET);
  if (!payload) return null;

  await ensureUserRow(ctx as APIContext, payload.userId, payload.email);
  return {
    user: { id: payload.userId, email: payload.email, scopes: payload.scopes ?? [] },
    jwt: payload,
  };
}

// ── App-Admin scope check (auth.ljs.app's `admin` or Slate's `slate:admin`) ─

export function isAppAdmin(scopes: string[] | undefined): boolean {
  if (!scopes) return false;
  return scopes.includes('admin') || scopes.includes('slate:admin');
}

// Find-or-create our local user row keyed by the auth.ljs.app userId.
// Email may change upstream — keep ours in sync.
export async function ensureUserRow(
  ctx: APIContext,
  userId: string,
  email: string,
): Promise<void> {
  const db = getDb(ctx);
  const normalized = email.toLowerCase().trim();
  await db.prepare(
    `INSERT INTO users (id, email) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email`,
  ).bind(userId, normalized).run();
}

// ── Cookie helpers used by /api/auth/callback and /sign-out ───────────────

export function setSessionCookie(cookies: AstroCookies, token: string, ttlSeconds = 30 * 86400): void {
  cookies.set(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: ttlSeconds,
  });
}

export function clearSessionCookie(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}
