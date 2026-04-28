import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireUser } from '@/lib/access';
import { isAppAdmin } from '@/lib/auth';

export const prerender = false;

// Edit show notes. Allowed if: caller is the slot's assigned speaker, OR
// caller is App Admin, OR caller is any Speaker on the slate.
export const PATCH: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const slotId = ctx.params.id!;
    const body = await ctx.request.json() as { show_notes?: string };
    if (typeof body.show_notes !== 'string') throw new HttpError(400, 'invalid_show_notes');
    if (body.show_notes.length > 50_000) throw new HttpError(400, 'show_notes_too_long');

    const db = getDb(ctx);
    const slot = await db.prepare(
      `SELECT sl.slate_id, sl.speaker_id,
              (SELECT 1 FROM slate_members
                WHERE slate_id = sl.slate_id AND user_id = ? AND role = 'speaker') AS is_speaker
       FROM slots sl WHERE sl.id = ?`,
    ).bind(user.id, slotId).first<{ slate_id: string; speaker_id: string | null; is_speaker: number | null }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');

    const allowed = slot.speaker_id === user.id || slot.is_speaker || isAppAdmin(user.scopes);
    if (!allowed) throw new HttpError(403, 'forbidden');

    await db.prepare('UPDATE slots SET show_notes = ? WHERE id = ?').bind(body.show_notes, slotId).run();
    return jsonOk();
  } catch (err) { return jsonError(err); }
};
