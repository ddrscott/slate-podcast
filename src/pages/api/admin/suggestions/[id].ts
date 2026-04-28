import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireSpeakerOnSlate } from '@/lib/access';

export const prerender = false;

// Speaker-only suggestion moderation. Edits status (open/archived) or content.
export const PATCH: APIRoute = async (ctx) => {
  try {
    const id = ctx.params.id!;
    const db = getDb(ctx);
    const sug = await db.prepare('SELECT slate_id FROM suggestions WHERE id = ?').bind(id)
      .first<{ slate_id: string }>();
    if (!sug) throw new HttpError(404, 'not_found');
    await requireSpeakerOnSlate(ctx, sug.slate_id);

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
    await db.prepare(`UPDATE suggestions SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    return jsonOk();
  } catch (err) { return jsonError(err); }
};
