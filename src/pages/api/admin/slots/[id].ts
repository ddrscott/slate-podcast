import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireHostOnSlate } from '@/lib/access';

export const prerender = false;

// Host-level edits to a slot's metadata: status (e.g. cancelled),
// duration, internal notes. (Topic and host assignment have their
// own narrower endpoints.)
export const PATCH: APIRoute = async (ctx) => {
  try {
    const slotId = ctx.params.id!;
    const db = getDb(ctx);
    const slot = await db.prepare('SELECT slate_id FROM slots WHERE id = ?').bind(slotId)
      .first<{ slate_id: string }>();
    if (!slot) throw new HttpError(404, 'not_found');
    await requireHostOnSlate(ctx, slot.slate_id);

    const body = await ctx.request.json() as Record<string, unknown>;
    const allowed = ['status','custom_title','notes_internal','duration_minutes'];
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const k of allowed) {
      if (k in body) {
        if (k === 'status') {
          const v = String(body.status);
          if (!['open','assigned','confirmed','recorded','published','cancelled'].includes(v)) {
            throw new HttpError(400, 'invalid_status');
          }
        }
        // notes_internal can hold a large markdown corpus; cap well under
        // D1's 2 MB row limit. custom_title is a one-line override.
        if (k === 'notes_internal' && typeof body[k] === 'string' && (body[k] as string).length > 1_000_000) {
          throw new HttpError(400, 'notes_internal_too_long');
        }
        if (k === 'custom_title' && typeof body[k] === 'string' && (body[k] as string).length > 200) {
          throw new HttpError(400, 'custom_title_too_long');
        }
        fields.push(`${k} = ?`);
        values.push(body[k]);
      }
    }
    if (fields.length === 0) throw new HttpError(400, 'nothing_to_update');
    values.push(slotId);

    await db.prepare(`UPDATE slots SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    return jsonOk();
  } catch (err) { return jsonError(err); }
};
