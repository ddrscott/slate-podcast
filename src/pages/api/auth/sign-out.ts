import type { APIRoute } from 'astro';
import { clearSessionCookie } from '@/lib/auth';

export const prerender = false;

export const POST: APIRoute = (ctx) => {
  clearSessionCookie(ctx.cookies);
  return ctx.redirect('/');
};
