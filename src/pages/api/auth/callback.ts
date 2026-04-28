import type { APIRoute } from 'astro';
import { getEnv } from '@/lib/db';
import { ensureUserRow, setSessionCookie, verifySessionToken } from '@/lib/auth';

export const prerender = false;

// auth.ljs.app appends ?token=<jwt> to whatever returnTo URL we sent.
// We tell it to come back here, with our final destination carried in ?next=.
export const GET: APIRoute = async (ctx) => {
  const env = getEnv(ctx);
  const url = new URL(ctx.request.url);
  const token = url.searchParams.get('token');
  const next = url.searchParams.get('next') ?? '/me';

  if (!token) return ctx.redirect('/?auth_error=missing_token');
  if (!env.JWT_SECRET) return new Response('Server misconfigured: missing JWT_SECRET', { status: 500 });

  const payload = await verifySessionToken(token, env.JWT_SECRET);
  if (!payload) return ctx.redirect('/?auth_error=invalid_token');

  await ensureUserRow(ctx, payload.userId, payload.email);

  // Browser-supplied `next` is restricted to same-site paths to avoid open redirects.
  const safeNext = isSafePath(next) ? next : '/me';

  // Cookie maxAge mirrors auth.ljs.app's 30-day token lifetime.
  setSessionCookie(ctx.cookies, token, 30 * 86400);
  return ctx.redirect(safeNext);
};

function isSafePath(s: string): boolean {
  return typeof s === 'string' && s.startsWith('/') && !s.startsWith('//');
}
