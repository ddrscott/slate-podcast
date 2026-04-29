import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireSpeakerOnSlate, requireUser } from '@/lib/access';

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
      const { isAppAdmin } = await import('@/lib/auth');
      if (!isAppAdmin(caller.scopes)) throw new HttpError(403, 'app_admin_required_to_assign_other');
    }

    // The new speaker must themselves be a Speaker on the slate.
    const member = await db.prepare(
      `SELECT role FROM slate_members WHERE slate_id = ? AND user_id = ?`,
    ).bind(slot.slate_id, targetUserId).first<{ role: string }>();
    const { isAppAdmin } = await import('@/lib/auth');
    const callerScopes = caller.scopes ?? [];
    const targetIsAppAdmin = targetUserId === caller.id ? isAppAdmin(callerScopes) : false;
    if ((!member || member.role !== 'speaker') && !targetIsAppAdmin) {
      throw new HttpError(409, 'target_not_a_speaker');
    }

    // status: assigned if no topic, confirmed if topic already set
    const newStatus = slot.suggestion_id ? 'confirmed' : 'assigned';
    await db.prepare(
      'UPDATE slots SET speaker_id = ?, status = ? WHERE id = ?',
    ).bind(targetUserId, newStatus, slotId).run();

    return jsonOk({ speaker_id: targetUserId, status: newStatus });
  } catch (err) { return jsonError(err); }
};

// Speaker releases the slot. Only the current speaker (or App Admin) can release.
export const DELETE: APIRoute = async (ctx) => {
  try {
    const caller = requireUser(ctx);
    const slotId = ctx.params.id!;
    const db = getDb(ctx);

    const slot = await db.prepare('SELECT slate_id, speaker_id FROM slots WHERE id = ?')
      .bind(slotId).first<{ slate_id: string; speaker_id: string | null }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');

    const { isAppAdmin } = await import('@/lib/auth');
    const isCurrentSpeaker = slot.speaker_id === caller.id;
    if (!isCurrentSpeaker && !isAppAdmin(caller.scopes)) {
      throw new HttpError(403, 'forbidden');
    }

    await db.prepare(
      `UPDATE slots SET speaker_id = NULL, status = CASE
         WHEN suggestion_id IS NULL THEN 'open' ELSE 'open' END
       WHERE id = ?`,
    ).bind(slotId).run();

    return jsonOk();
  } catch (err) { return jsonError(err); }
};
