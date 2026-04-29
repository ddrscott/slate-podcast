import type { APIRoute } from 'astro';
import { getDb, now } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireUser } from '@/lib/access';
import { isAppAdmin } from '@/lib/auth';
import { Enqueue } from '@/lib/activity';

export const prerender = false;

// Marry a topic to a slot. Caller must be the slot's host (or App Admin).
// Sets slot.topic_id + slot.status='confirmed', and flips the topic
// to status='scheduled'.
export const POST: APIRoute = async (ctx) => {
  try {
    const caller = requireUser(ctx);
    const slotId = ctx.params.id!;
    const body = await ctx.request.json() as { topic_id?: string | null; custom_title?: string | null };

    const db = getDb(ctx);
    const slot = await db.prepare(
      'SELECT slate_id, host_id, topic_id, status FROM slots WHERE id = ?',
    ).bind(slotId).first<{ slate_id: string; host_id: string | null; topic_id: string | null; status: string }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');

    const allowed = slot.host_id === caller.id || isAppAdmin(caller.scopes);
    if (!allowed) throw new HttpError(403, 'must_be_host_of_slot');

    const wasConfirmedLike = ['confirmed','recorded','published'].includes(slot.status);

    // Detach if topic_id is null
    if (!body.topic_id) {
      const newStatus = slot.host_id ? 'assigned' : 'open';
      const stmts = [
        db.prepare(`UPDATE slots SET topic_id = NULL, custom_title = ?,
                    status = CASE WHEN host_id IS NULL THEN 'open' ELSE 'assigned' END
                    WHERE id = ?`).bind(body.custom_title ?? null, slotId),
      ];
      if (slot.topic_id) {
        stmts.push(db.prepare(
          `UPDATE topics SET status = 'open', scheduled_slot_id = NULL,
           scheduled_at = NULL, scheduled_by = NULL WHERE id = ?`,
        ).bind(slot.topic_id));
      }
      await db.batch(stmts);

      // Topic detached. If the slot was scheduled-or-later, this is an
      // unschedule event in the activity feed.
      if (wasConfirmedLike && slot.topic_id) {
        await Enqueue.topicDetached(ctx, {
          slateId: slot.slate_id, actorId: caller.id, slotId, topicId: slot.topic_id,
        });
      }

      return jsonOk({ status: newStatus });
    }

    // Verify topic belongs to the same slate
    const sug = await db.prepare(
      'SELECT slate_id, status FROM topics WHERE id = ?',
    ).bind(body.topic_id).first<{ slate_id: string; status: string }>();
    if (!sug) throw new HttpError(404, 'topic_not_found');
    if (sug.slate_id !== slot.slate_id) throw new HttpError(400, 'slate_mismatch');
    if (sug.status === 'archived') throw new HttpError(409, 'topic_archived');

    const t = now();
    const newStatus = slot.host_id ? 'confirmed' : 'assigned';
    const stmts = [
      db.prepare(
        `UPDATE slots SET topic_id = ?, custom_title = ?, status = ? WHERE id = ?`,
      ).bind(body.topic_id, body.custom_title ?? null, newStatus, slotId),
      db.prepare(
        `UPDATE topics SET status = 'scheduled', scheduled_slot_id = ?, scheduled_at = ?,
         scheduled_by = ? WHERE id = ?`,
      ).bind(slotId, t, caller.id, body.topic_id),
    ];
    // If we replaced an old topic, free it back to 'open'
    if (slot.topic_id && slot.topic_id !== body.topic_id) {
      stmts.push(db.prepare(
        `UPDATE topics SET status = 'open', scheduled_slot_id = NULL, scheduled_at = NULL,
         scheduled_by = NULL WHERE id = ?`,
      ).bind(slot.topic_id));
    }
    await db.batch(stmts);

    // Activity: a slot becoming 'confirmed' is the schedule event. If it was
    // already confirmed (just swapping topics), record it as a topic change
    // by attaching the previous topic to the meta.
    if (newStatus === 'confirmed') {
      await Enqueue.slotScheduled(ctx, {
        slateId: slot.slate_id,
        actorId: caller.id,
        slotId,
        topicId: body.topic_id,
        replacedTopicId:
          slot.topic_id && slot.topic_id !== body.topic_id
            ? slot.topic_id
            : undefined,
      });
    }

    return jsonOk({ status: newStatus });
  } catch (err) { return jsonError(err); }
};
