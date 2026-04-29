import type { APIRoute } from 'astro';
import { fingerprint, getDb } from '@/lib/db';
import { jsonError, jsonOk, requireMemberOnSlate } from '@/lib/access';

export const prerender = false;

// Live duplicate check used by the topic form (debounced as the user types).
// Returns up to 3 nearest matches ordered by exact-fingerprint first, then prefix.
export const GET: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    await requireMemberOnSlate(ctx, slateId);

    const url = new URL(ctx.request.url);
    const title = (url.searchParams.get('title') ?? '').slice(0, 200);
    const fp = fingerprint(title);
    if (!fp) return jsonOk({ matches: [] });

    const db = getDb(ctx);
    const exact = await db.prepare(
      `SELECT id, title, upvote_count, status FROM topics
       WHERE slate_id = ? AND fingerprint = ? LIMIT 1`,
    ).bind(slateId, fp).all<{ id: string; title: string; upvote_count: number; status: string }>();

    const prefix = await db.prepare(
      `SELECT id, title, upvote_count, status FROM topics
       WHERE slate_id = ? AND fingerprint LIKE ? AND fingerprint != ?
       ORDER BY upvote_count DESC LIMIT 3`,
    ).bind(slateId, `${fp}%`, fp).all<{ id: string; title: string; upvote_count: number; status: string }>();

    return jsonOk({ matches: [...exact.results, ...prefix.results].slice(0, 3) });
  } catch (err) { return jsonError(err); }
};
