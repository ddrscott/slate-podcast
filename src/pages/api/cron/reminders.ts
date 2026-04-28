import type { APIRoute } from 'astro';
import { getDb, getEnv } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/access';
import { runReminders } from '@/lib/reminders';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  try {
    const env = getEnv(ctx);
    const auth = ctx.request.headers.get('authorization') ?? '';
    const expected = `Bearer ${env.CRON_SECRET ?? ''}`;
    if (!env.CRON_SECRET || auth !== expected) {
      return new Response('unauthorized', { status: 401 });
    }
    const db = getDb(ctx);
    const result = await runReminders(env, db);
    return jsonOk(result);
  } catch (err) { return jsonError(err); }
};
