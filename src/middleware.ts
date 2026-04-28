import { defineMiddleware } from 'astro:middleware';
import { getCurrentUser } from './lib/auth';

export const onRequest = defineMiddleware(async (ctx, next) => {
  if (ctx.locals.runtime?.env) {
    try {
      const result = await getCurrentUser(ctx);
      if (result) {
        ctx.locals.user = result.user;
        ctx.locals.jwt = result.jwt;
      }
    } catch (err) {
      console.error('[middleware] session lookup failed', err);
    }
  }
  return next();
});
