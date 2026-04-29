import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireHostOnSlate, requireUser } from '@/lib/access';
import { Enqueue } from '@/lib/activity';

export const prerender = false;

// Host-only topic moderation. Edits status (open/archived) or content.
export const PATCH: APIRoute = async (ctx) => {
  try {
    const caller = requireUser(ctx);
    const id = ctx.params.id!;
    const db = getDb(ctx);
    const sug = await db.prepare('SELECT slate_id, status FROM topics WHERE id = ?').bind(id)
      .first<{ slate_id: string; status: string }>();
    if (!sug) throw new HttpError(404, 'not_found');
    await requireHostOnSlate(ctx, sug.slate_id);

    const body = await ctx.request.json() as { status?: string; tags?: string; title?: string; description?: string };
    const fields: string[] = [];
    const values: unknown[] = [];

    if (body.status) {
      if (!['open','scheduled','archived'].includes(body.status)) throw new HttpError(400, 'invalid_status');
      fields.push('status = ?'); values.push(body.status);
    }
    if (typeof body.tags === 'string') { fields.push('tags = ?'); values.push(body.tags); }
    if (typeof body.title === 'string') { fields.push('title = ?'); values.push(body.title); }
    if (typeof body.description === 'string') { fields.push('description = ?'); values.push(body.description); }

    if (fields.length === 0) throw new HttpError(400, 'nothing_to_update');
    values.push(id);
    await db.prepare(`UPDATE topics SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

    // Archiving is a notable moderation event — log it.
    if (body.status === 'archived' && sug.status !== 'archived') {
      await Enqueue.topicArchived(ctx, {
        slateId: sug.slate_id, actorId: caller.id, topicId: id,
      });
    }

    return jsonOk();
  } catch (err) { return jsonError(err); }
};
