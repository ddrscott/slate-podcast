import type { APIRoute } from 'astro';
import { getDb, now } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireSpeakerOnSlate, requireUser } from '@/lib/access';
import { isAppAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

export const prerender = false;

// One-shot: claim a slot AND marry a suggestion to it. Used by the
// side-panel/bottom-sheet "Claim & Schedule" UX so a Speaker doesn't
// see a half-applied state if either step fails.
//
// Allowed:
//  - the slot is `open` (any speaker on the slate can take it), OR
//  - the slot is `assigned` to the caller (just adding the topic).
//
// Boot-another-speaker is intentionally NOT done here — that's a
// destructive action that should still go through the explicit
// /assign-speaker endpoint.
export const POST: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const slotId = ctx.params.id!;
    const body = await ctx.request.json() as { suggestion_id?: string };
    const suggestionId = body.suggestion_id?.trim();
    if (!suggestionId) throw new HttpError(400, 'suggestion_id_required');

    const db = getDb(ctx);
    const slot = await db.prepare(
      'SELECT slate_id, status, speaker_id, suggestion_id, start_time, duration_minutes FROM slots WHERE id = ?',
    ).bind(slotId).first<{ slate_id: string; status: string; speaker_id: string | null; suggestion_id: string | null; start_time: number; duration_minutes: number }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');
    if (slot.status === 'cancelled') throw new HttpError(409, 'slot_cancelled');

    await requireSpeakerOnSlate(ctx, slot.slate_id);

    // Refuse to overwrite an existing assignment to a different speaker —
    // that's the boot path and goes through /assign-speaker explicitly.
    if (slot.speaker_id && slot.speaker_id !== user.id) {
      throw new HttpError(409, 'slot_taken_by_another_speaker');
    }

    const sug = await db.prepare(
      'SELECT slate_id, status, scheduled_slot_id FROM suggestions WHERE id = ?',
    ).bind(suggestionId).first<{ slate_id: string; status: string; scheduled_slot_id: string | null }>();
    if (!sug) throw new HttpError(404, 'suggestion_not_found');
    if (sug.slate_id !== slot.slate_id) throw new HttpError(400, 'slate_mismatch');
    if (sug.status === 'archived') throw new HttpError(409, 'suggestion_archived');
    if (sug.status === 'scheduled' && sug.scheduled_slot_id !== slotId) {
      throw new HttpError(409, 'suggestion_already_scheduled');
    }

    const t = now();
    const stmts = [
      db.prepare(
        `UPDATE slots SET speaker_id = ?, suggestion_id = ?, status = 'confirmed' WHERE id = ?`,
      ).bind(user.id, suggestionId, slotId),
      db.prepare(
        `UPDATE suggestions SET status = 'scheduled', scheduled_slot_id = ?, scheduled_at = ?,
         scheduled_by = ? WHERE id = ?`,
      ).bind(slotId, t, user.id, suggestionId),
    ];
    // If the slot previously had a different suggestion attached (the speaker
    // changed their mind via this same UI), free the old one back to 'open'.
    if (slot.suggestion_id && slot.suggestion_id !== suggestionId) {
      stmts.push(db.prepare(
        `UPDATE suggestions SET status = 'open', scheduled_slot_id = NULL, scheduled_at = NULL,
         scheduled_by = NULL WHERE id = ?`,
      ).bind(slot.suggestion_id));
    }
    await db.batch(stmts);

    await logActivity(ctx, {
      kind: 'slot_scheduled',
      slateId: slot.slate_id,
      actorId: user.id,
      slotId,
      suggestionId,
    });

    return jsonOk({
      slot_id: slotId,
      suggestion_id: suggestionId,
      status: 'confirmed',
      start_time: slot.start_time,
      duration_minutes: slot.duration_minutes,
      speaker_id: user.id,
      speaker_email: user.email,
    });
  } catch (err) { return jsonError(err); }
};

// Undo the claim-and-schedule for the slot's *current* speaker. Releases
// both the slot (back to status='open', no speaker) AND the topic
// (suggestion back to status='open'). Allowed for the slot's current
// speaker, or an App Admin.
//
// Symmetric counterpart to POST. The narrower "just detach the topic"
// path stays on POST /api/slots/[id]/topic with `{suggestion_id: null}`.
export const DELETE: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const slotId = ctx.params.id!;
    const db = getDb(ctx);

    const slot = await db.prepare(
      'SELECT slate_id, speaker_id, suggestion_id FROM slots WHERE id = ?',
    ).bind(slotId).first<{ slate_id: string; speaker_id: string | null; suggestion_id: string | null }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');

    const allowed = slot.speaker_id === user.id || isAppAdmin(user.scopes);
    if (!allowed) throw new HttpError(403, 'forbidden');

    const stmts = [
      db.prepare(
        `UPDATE slots SET speaker_id = NULL, suggestion_id = NULL, status = 'open'
         WHERE id = ?`,
      ).bind(slotId),
    ];
    if (slot.suggestion_id) {
      stmts.push(db.prepare(
        `UPDATE suggestions SET status = 'open', scheduled_slot_id = NULL, scheduled_at = NULL,
         scheduled_by = NULL WHERE id = ?`,
      ).bind(slot.suggestion_id));
    }
    await db.batch(stmts);

    await logActivity(ctx, {
      kind: 'slot_unscheduled',
      slateId: slot.slate_id,
      actorId: user.id,
      slotId,
      suggestionId: slot.suggestion_id ?? null,
    });

    return jsonOk({
      slot_id: slotId,
      slot_status: 'open',
      freed_suggestion_id: slot.suggestion_id,
    });
  } catch (err) { return jsonError(err); }
};
