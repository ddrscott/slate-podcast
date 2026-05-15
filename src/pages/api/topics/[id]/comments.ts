import type { APIRoute } from 'astro';
import { getDb, now, randomId } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireMemberOnSlate } from '@/lib/access';
import { Enqueue } from '@/lib/activity';

export const prerender = false;

// POST /api/topics/[id]/comments — create a comment or reply.
// Body: { body: string, parent_id?: string | null }
//
// Access: any member (or host, or App Admin) on the topic's slate.
// Returns: { comment: { id, created_at } }

const MAX_BODY_LEN = 10_000;

export const POST: APIRoute = async (ctx) => {
  try {
    const topicId = ctx.params.id!;
    const db = getDb(ctx);

    const topic = await db.prepare(
      'SELECT id, slate_id FROM topics WHERE id = ?',
    ).bind(topicId).first<{ id: string; slate_id: string }>();
    if (!topic) throw new HttpError(404, 'topic_not_found');

    await requireMemberOnSlate(ctx, topic.slate_id);
    const user = ctx.locals.user!;

    const raw = await ctx.request.json() as { body?: unknown; parent_id?: unknown };
    if (typeof raw.body !== 'string') throw new HttpError(400, 'invalid_body');
    const body = raw.body.trim();
    if (body.length === 0) throw new HttpError(400, 'empty_body');
    if (body.length > MAX_BODY_LEN) throw new HttpError(400, 'body_too_long');

    let parentId: string | null = null;
    if (raw.parent_id !== undefined && raw.parent_id !== null && raw.parent_id !== '') {
      if (typeof raw.parent_id !== 'string') throw new HttpError(400, 'invalid_parent_id');
      // Verify the parent exists AND belongs to the same topic. Keeps
      // the thread well-formed; rejects cross-topic reply attempts.
      const parent = await db.prepare(
        'SELECT id FROM comments WHERE id = ? AND topic_id = ?',
      ).bind(raw.parent_id, topicId).first();
      if (!parent) throw new HttpError(400, 'parent_not_found');
      parentId = raw.parent_id;
    }

    const id = `cmt_${randomId(12)}`;
    const t = now();
    await db.prepare(
      `INSERT INTO comments (id, slate_id, topic_id, parent_id, author_id, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, topic.slate_id, topicId, parentId, user.id, body, t).run();

    await Enqueue.topicCommented(ctx, {
      slateId: topic.slate_id,
      actorId: user.id,
      topicId,
      commentId: id,
      isReply: !!parentId,
    });

    return jsonOk({ comment: { id, created_at: t } }, 201);
  } catch (err) { return jsonError(err); }
};
