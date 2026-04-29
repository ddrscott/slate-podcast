import type { APIRoute } from 'astro';
import { getDb, now } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireUser } from '@/lib/access';
import { isAppAdmin } from '@/lib/auth';
import { Enqueue } from '@/lib/activity';

export const prerender = false;

// Marry a suggestion to a slot. Caller must be the slot's speaker (or App Admin).
// Sets slot.suggestion_id + slot.status='confirmed', and flips the suggestion
// to status='scheduled'.
export const POST: APIRoute = async (ctx) => {
  try {
    const caller = requireUser(ctx);
    const slotId = ctx.params.id!;
    const body = await ctx.request.json() as { suggestion_id?: string | null; custom_title?: string | null };

    const db = getDb(ctx);
    const slot = await db.prepare(
      'SELECT slate_id, speaker_id, suggestion_id, status FROM slots WHERE id = ?',
    ).bind(slotId).first<{ slate_id: string; speaker_id: string | null; suggestion_id: string | null; status: string }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');

    const allowed = slot.speaker_id === caller.id || isAppAdmin(caller.scopes);
    if (!allowed) throw new HttpError(403, 'must_be_speaker_of_slot');

    const wasConfirmedLike = ['confirmed','recorded','published'].includes(slot.status);

    // Detach if suggestion_id is null
    if (!body.suggestion_id) {
      const newStatus = slot.speaker_id ? 'assigned' : 'open';
      const stmts = [
        db.prepare(`UPDATE slots SET suggestion_id = NULL, custom_title = ?,
                    status = CASE WHEN speaker_id IS NULL THEN 'open' ELSE 'assigned' END
                    WHERE id = ?`).bind(body.custom_title ?? null, slotId),
      ];
      if (slot.suggestion_id) {
        stmts.push(db.prepare(
          `UPDATE suggestions SET status = 'open', scheduled_slot_id = NULL,
           scheduled_at = NULL, scheduled_by = NULL WHERE id = ?`,
        ).bind(slot.suggestion_id));
      }
      await db.batch(stmts);

      // Topic detached. If the slot was scheduled-or-later, this is an
      // unschedule event in the activity feed.
      if (wasConfirmedLike && slot.suggestion_id) {
        await Enqueue.topicDetached(ctx, {
          slateId: slot.slate_id, actorId: caller.id, slotId, suggestionId: slot.suggestion_id,
        });
      }

      return jsonOk({ status: newStatus });
    }

    // Verify suggestion belongs to the same slate
    const sug = await db.prepare(
      'SELECT slate_id, status FROM suggestions WHERE id = ?',
    ).bind(body.suggestion_id).first<{ slate_id: string; status: string }>();
    if (!sug) throw new HttpError(404, 'suggestion_not_found');
    if (sug.slate_id !== slot.slate_id) throw new HttpError(400, 'slate_mismatch');
    if (sug.status === 'archived') throw new HttpError(409, 'suggestion_archived');

    const t = now();
    const newStatus = slot.speaker_id ? 'confirmed' : 'assigned';
    const stmts = [
      db.prepare(
        `UPDATE slots SET suggestion_id = ?, custom_title = ?, status = ? WHERE id = ?`,
      ).bind(body.suggestion_id, body.custom_title ?? null, newStatus, slotId),
      db.prepare(
        `UPDATE suggestions SET status = 'scheduled', scheduled_slot_id = ?, scheduled_at = ?,
         scheduled_by = ? WHERE id = ?`,
      ).bind(slotId, t, caller.id, body.suggestion_id),
    ];
    // If we replaced an old suggestion, free it back to 'open'
    if (slot.suggestion_id && slot.suggestion_id !== body.suggestion_id) {
      stmts.push(db.prepare(
        `UPDATE suggestions SET status = 'open', scheduled_slot_id = NULL, scheduled_at = NULL,
         scheduled_by = NULL WHERE id = ?`,
      ).bind(slot.suggestion_id));
    }
    await db.batch(stmts);

    // Activity: a slot becoming 'confirmed' is the schedule event. If it was
    // already confirmed (just swapping topics), record it as a topic change
    // by attaching the previous suggestion to the meta.
    if (newStatus === 'confirmed') {
      await Enqueue.slotScheduled(ctx, {
        slateId: slot.slate_id,
        actorId: caller.id,
        slotId,
        suggestionId: body.suggestion_id,
        replacedSuggestionId:
          slot.suggestion_id && slot.suggestion_id !== body.suggestion_id
            ? slot.suggestion_id
            : undefined,
      });
    }

    return jsonOk({ status: newStatus });
  } catch (err) { return jsonError(err); }
};
