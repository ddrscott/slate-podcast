import type { APIRoute } from 'astro';
import { getDb, now } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireSpeakerOnSlate } from '@/lib/access';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  try {
    const slotId = ctx.params.id!;
    const action = ctx.params.action;

    const db = getDb(ctx);
    const slot = await db.prepare('SELECT slate_id FROM slots WHERE id = ?').bind(slotId)
      .first<{ slate_id: string }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');
    await requireSpeakerOnSlate(ctx, slot.slate_id);

    if (action === 'publish-notes') {
      await db.prepare('UPDATE slots SET show_notes_published_at = ? WHERE id = ?').bind(now(), slotId).run();
      return jsonOk({ published_at: now() });
    }
    if (action === 'unpublish-notes') {
      await db.prepare('UPDATE slots SET show_notes_published_at = NULL WHERE id = ?').bind(slotId).run();
      return jsonOk({ published_at: null });
    }
    throw new HttpError(400, 'invalid_action');
  } catch (err) { return jsonError(err); }
};
