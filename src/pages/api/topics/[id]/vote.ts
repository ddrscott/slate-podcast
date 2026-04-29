import type { APIRoute } from 'astro';
import { getDb, now } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireMemberOnSlate, requireUser } from '@/lib/access';

export const prerender = false;

// Toggle an upvote on a topic. Returns the new count + has_voted.
// Members and Hosts (and App Admins on any slate) can vote.
export const POST: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const id = ctx.params.id!;
    const db = getDb(ctx);

    const sug = await db.prepare(
      'SELECT slate_id, status, upvote_count FROM topics WHERE id = ?',
    ).bind(id).first<{ slate_id: string; status: string; upvote_count: number }>();
    if (!sug) throw new HttpError(404, 'topic_not_found');
    if (sug.status === 'archived') throw new HttpError(409, 'topic_archived');
    await requireMemberOnSlate(ctx, sug.slate_id);

    const existing = await db.prepare(
      'SELECT 1 AS yes FROM topic_votes WHERE topic_id = ? AND user_id = ?',
    ).bind(id, user.id).first<{ yes: number }>();

    if (existing) {
      // Toggle off
      await db.batch([
        db.prepare('DELETE FROM topic_votes WHERE topic_id = ? AND user_id = ?').bind(id, user.id),
        db.prepare('UPDATE topics SET upvote_count = upvote_count - 1 WHERE id = ?').bind(id),
      ]);
      return jsonOk({ has_voted: false, upvote_count: sug.upvote_count - 1 });
    } else {
      await db.batch([
        db.prepare('INSERT INTO topic_votes (topic_id, user_id, voted_at) VALUES (?, ?, ?)')
          .bind(id, user.id, now()),
        db.prepare('UPDATE topics SET upvote_count = upvote_count + 1 WHERE id = ?').bind(id),
      ]);
      return jsonOk({ has_voted: true, upvote_count: sug.upvote_count + 1 });
    }
  } catch (err) { return jsonError(err); }
};
