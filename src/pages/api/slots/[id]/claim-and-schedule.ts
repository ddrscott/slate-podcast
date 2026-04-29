import type { APIRoute } from 'astro';
import { getDb, now } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireHostOnSlate, requireUser } from '@/lib/access';
import { isAppAdmin } from '@/lib/auth';
import { Enqueue } from '@/lib/activity';

export const prerender = false;

// One-shot: claim a slot AND marry a topic to it. Used by the
// side-panel/bottom-sheet "Claim & Schedule" UX so a Host doesn't
// see a half-applied state if either step fails.
//
// Allowed:
//  - the slot is `open` (any host on the slate can take it), OR
//  - the slot is `assigned` to the caller (just adding the topic).
//
// Subbing in for another host is intentionally NOT done here — it's
// a deliberate ownership change that should go through the explicit
// /assign-host endpoint.
export const POST: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const slotId = ctx.params.id!;
    const body = await ctx.request.json() as { topic_id?: string };
    const topicId = body.topic_id?.trim();
    if (!topicId) throw new HttpError(400, 'topic_id_required');

    const db = getDb(ctx);
    const slot = await db.prepare(
      'SELECT slate_id, status, host_id, topic_id, start_time, duration_minutes FROM slots WHERE id = ?',
    ).bind(slotId).first<{ slate_id: string; status: string; host_id: string | null; topic_id: string | null; start_time: number; duration_minutes: number }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');
    if (slot.status === 'cancelled') throw new HttpError(409, 'slot_cancelled');

    await requireHostOnSlate(ctx, slot.slate_id);

    // Refuse to overwrite an existing assignment to a different host —
    // that's the substitute-in path and goes through /assign-host explicitly.
    if (slot.host_id && slot.host_id !== user.id) {
      throw new HttpError(409, 'slot_taken_by_another_host');
    }

    const sug = await db.prepare(
      'SELECT slate_id, status, scheduled_slot_id FROM topics WHERE id = ?',
    ).bind(topicId).first<{ slate_id: string; status: string; scheduled_slot_id: string | null }>();
    if (!sug) throw new HttpError(404, 'topic_not_found');
    if (sug.slate_id !== slot.slate_id) throw new HttpError(400, 'slate_mismatch');
    if (sug.status === 'archived') throw new HttpError(409, 'topic_archived');
    if (sug.status === 'scheduled' && sug.scheduled_slot_id !== slotId) {
      throw new HttpError(409, 'topic_already_scheduled');
    }

    const t = now();
    const stmts = [
      db.prepare(
        `UPDATE slots SET host_id = ?, topic_id = ?, status = 'confirmed' WHERE id = ?`,
      ).bind(user.id, topicId, slotId),
      db.prepare(
        `UPDATE topics SET status = 'scheduled', scheduled_slot_id = ?, scheduled_at = ?,
         scheduled_by = ? WHERE id = ?`,
      ).bind(slotId, t, user.id, topicId),
    ];
    // If the slot previously had a different topic attached (the host
    // changed their mind via this same UI), free the old one back to 'open'.
    if (slot.topic_id && slot.topic_id !== topicId) {
      stmts.push(db.prepare(
        `UPDATE topics SET status = 'open', scheduled_slot_id = NULL, scheduled_at = NULL,
         scheduled_by = NULL WHERE id = ?`,
      ).bind(slot.topic_id));
    }
    await db.batch(stmts);

    await Enqueue.slotScheduled(ctx, {
      slateId: slot.slate_id, actorId: user.id, slotId, topicId,
    });

    return jsonOk({
      slot_id: slotId,
      topic_id: topicId,
      status: 'confirmed',
      start_time: slot.start_time,
      duration_minutes: slot.duration_minutes,
      host_id: user.id,
      host_email: user.email,
      host_display_name: user.display_name,
    });
  } catch (err) { return jsonError(err); }
};

// Undo the claim-and-schedule for the slot's *current* host. Releases
// both the slot (back to status='open', no host) AND the topic
// (topic back to status='open'). Allowed for the slot's current
// host, or an App Admin.
//
// Symmetric counterpart to POST. The narrower "just detach the topic"
// path stays on POST /api/slots/[id]/topic with `{topic_id: null}`.
export const DELETE: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const slotId = ctx.params.id!;
    const db = getDb(ctx);

    const slot = await db.prepare(
      'SELECT slate_id, host_id, topic_id FROM slots WHERE id = ?',
    ).bind(slotId).first<{ slate_id: string; host_id: string | null; topic_id: string | null }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');

    const allowed = slot.host_id === user.id || isAppAdmin(user.scopes);
    if (!allowed) throw new HttpError(403, 'forbidden');

    const stmts = [
      db.prepare(
        `UPDATE slots SET host_id = NULL, topic_id = NULL, status = 'open'
         WHERE id = ?`,
      ).bind(slotId),
    ];
    if (slot.topic_id) {
      stmts.push(db.prepare(
        `UPDATE topics SET status = 'open', scheduled_slot_id = NULL, scheduled_at = NULL,
         scheduled_by = NULL WHERE id = ?`,
      ).bind(slot.topic_id));
    }
    await db.batch(stmts);

    await Enqueue.slotUnscheduled(ctx, {
      slateId: slot.slate_id, actorId: user.id, slotId, topicId: slot.topic_id ?? null,
    });

    return jsonOk({
      slot_id: slotId,
      slot_status: 'open',
      freed_topic_id: slot.topic_id,
    });
  } catch (err) { return jsonError(err); }
};
