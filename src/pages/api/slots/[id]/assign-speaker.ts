import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireSpeakerOnSlate, requireUser } from '@/lib/access';
import { isAppAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

export const prerender = false;

// Speaker claims a slot (or subs in for another speaker on it).
// Body: optional { user_id } — defaults to caller. Only App Admins can assign others.
export const POST: APIRoute = async (ctx) => {
  try {
    const caller = requireUser(ctx);
    const slotId = ctx.params.id!;
    const body = (await ctx.request.json().catch(() => ({}))) as { user_id?: string };

    const db = getDb(ctx);
    const slot = await db.prepare(
      'SELECT slate_id, status, speaker_id, suggestion_id FROM slots WHERE id = ?',
    ).bind(slotId).first<{ slate_id: string; status: string; speaker_id: string | null; suggestion_id: string | null }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');
    if (slot.status === 'cancelled') throw new HttpError(409, 'slot_cancelled');

    await requireSpeakerOnSlate(ctx, slot.slate_id);

    const targetUserId = body.user_id?.trim() || caller.id;

    // Self-assign vs. assigning others: only App Admin can assign someone else.
    if (targetUserId !== caller.id) {
      if (!isAppAdmin(caller.scopes)) throw new HttpError(403, 'app_admin_required_to_assign_other');
    }

    // The new speaker must themselves be a Speaker on the slate.
    const member = await db.prepare(
      `SELECT role FROM slate_members WHERE slate_id = ? AND user_id = ?`,
    ).bind(slot.slate_id, targetUserId).first<{ role: string }>();
    const callerScopes = caller.scopes ?? [];
    const targetIsAppAdmin = targetUserId === caller.id ? isAppAdmin(callerScopes) : false;
    if ((!member || member.role !== 'speaker') && !targetIsAppAdmin) {
      throw new HttpError(409, 'target_not_a_speaker');
    }

    const previousSpeakerId = slot.speaker_id;
    const isSubstitution = !!previousSpeakerId && previousSpeakerId !== targetUserId;

    // status: assigned if no topic, confirmed if topic already set
    const newStatus = slot.suggestion_id ? 'confirmed' : 'assigned';
    await db.prepare(
      'UPDATE slots SET speaker_id = ?, status = ? WHERE id = ?',
    ).bind(targetUserId, newStatus, slotId).run();

    // Activity: a substitution is the cooperative coverage event. A first-time
    // claim of an empty slot doesn't fire a slot_scheduled event by itself —
    // that fires when the topic also lands (claim-and-schedule, or topic.ts
    // turning the slot 'confirmed').
    //
    // We set target_user_id to the speaker who got covered for (previousSpeakerId),
    // so the activity feed's existing actor+target join renders naturally:
    // "{actor} subbed in for {target}". The new speaker's id lives in meta.
    if (isSubstitution) {
      await logActivity(ctx, {
        kind: 'speaker_substituted',
        slateId: slot.slate_id,
        actorId: caller.id,
        slotId,
        targetUserId: previousSpeakerId,
        suggestionId: slot.suggestion_id,
        meta: { new_speaker_id: targetUserId },
      });
    }

    return jsonOk({ speaker_id: targetUserId, status: newStatus });
  } catch (err) { return jsonError(err); }
};

// Speaker releases the slot. Only the current speaker (or App Admin) can release.
// Releases the topic too — the user's mental model is "the slot goes back to
// open and available", which means a stranded suggestion (still pointing at
// this slot, status='scheduled') would contradict that. Symmetric to the
// claim-and-schedule DELETE path.
export const DELETE: APIRoute = async (ctx) => {
  try {
    const caller = requireUser(ctx);
    const slotId = ctx.params.id!;
    const db = getDb(ctx);

    const slot = await db.prepare('SELECT slate_id, speaker_id, suggestion_id, status FROM slots WHERE id = ?')
      .bind(slotId).first<{ slate_id: string; speaker_id: string | null; suggestion_id: string | null; status: string }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');

    const isCurrentSpeaker = slot.speaker_id === caller.id;
    if (!isCurrentSpeaker && !isAppAdmin(caller.scopes)) {
      throw new HttpError(403, 'forbidden');
    }

    const stmts = [
      db.prepare(
        `UPDATE slots SET speaker_id = NULL, suggestion_id = NULL, status = 'open' WHERE id = ?`,
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
      actorId: caller.id,
      slotId,
      suggestionId: slot.suggestion_id,
      meta: { release: true },
    });

    return jsonOk({
      slot_id: slotId,
      slot_status: 'open',
      freed_suggestion_id: slot.suggestion_id,
    });
  } catch (err) { return jsonError(err); }
};
