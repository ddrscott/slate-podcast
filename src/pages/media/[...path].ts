import type { APIRoute } from 'astro';
import { getEnv } from '@/lib/db';

export const prerender = false;

// Public read-through proxy for our R2 media bucket. Caches at the edge.
// `path` is the everything-after-/media/ segment (e.g. `headshots/usr_xx/abc.jpg`).
export const GET: APIRoute = async (ctx) => {
  const env = getEnv(ctx);
  const key = ctx.params.path;
  if (!key || typeof key !== 'string') return new Response('Not found', { status: 404 });

  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  // 1h browser, 24h edge — images change rarely; cache busts on URL change since
  // we generate a fresh random suffix on each upload.
  headers.set('cache-control', 'public, max-age=3600, s-maxage=86400, immutable');
  return new Response(obj.body, { headers });
};
