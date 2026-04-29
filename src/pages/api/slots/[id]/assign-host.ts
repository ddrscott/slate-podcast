import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireHostOnSlate, requireUser } from '@/lib/access';
import { isAppAdmin } from '@/lib/auth';
import { Enqueue } from '@/lib/activity';

export const prerender = false;

// Host claims a slot (or subs in for another host on it).
// Body: optional { user_id } — defaults to caller. Only App Admins can assign others.
export const POST: APIRoute = async (ctx) => {
  try {
    const caller = requireUser(ctx);
    const slotId = ctx.params.id!;
    const body = (await ctx.request.json().catch(() => ({}))) as { user_id?: string };

    const db = getDb(ctx);
    const slot = await db.prepare(
      'SELECT slate_id, status, host_id, topic_id FROM slots WHERE id = ?',
    ).bind(slotId).first<{ slate_id: string; status: string; host_id: string | null; topic_id: string | null }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');
    if (slot.status === 'cancelled') throw new HttpError(409, 'slot_cancelled');

    await requireHostOnSlate(ctx, slot.slate_id);

    const targetUserId = body.user_id?.trim() || caller.id;

    // Self-assign vs. assigning others: only App Admin can assign someone else.
    if (targetUserId !== caller.id) {
      if (!isAppAdmin(caller.scopes)) throw new HttpError(403, 'app_admin_required_to_assign_other');
    }

    // The new host must themselves be a Host on the slate.
    const member = await db.prepare(
      `SELECT role FROM slate_members WHERE slate_id = ? AND user_id = ?`,
    ).bind(slot.slate_id, targetUserId).first<{ role: string }>();
    const callerScopes = caller.scopes ?? [];
    const targetIsAppAdmin = targetUserId === caller.id ? isAppAdmin(callerScopes) : false;
    if ((!member || member.role !== 'host') && !targetIsAppAdmin) {
      throw new HttpError(409, 'target_not_a_host');
    }

    const previousHostId = slot.host_id;
    const isSubstitution = !!previousHostId && previousHostId !== targetUserId;

    // status: assigned if no topic, confirmed if topic already set
    const newStatus = slot.topic_id ? 'confirmed' : 'assigned';
    await db.prepare(
      'UPDATE slots SET host_id = ?, status = ? WHERE id = ?',
    ).bind(targetUserId, newStatus, slotId).run();

    // Activity: a substitution is the cooperative coverage event. A first-time
    // claim of an empty slot doesn't fire a slot_scheduled event by itself —
    // that fires when the topic also lands (claim-and-schedule, or topic.ts
    // turning the slot 'confirmed').
    //
    // The Enqueue helper hides the target_user_id convention (previous
    // host → covered-for) so the activity feed renders correctly.
    if (isSubstitution) {
      await Enqueue.hostSubstituted(ctx, {
        slateId: slot.slate_id,
        actorId: caller.id,
        slotId,
        topicId: slot.topic_id,
        previousHostId: previousHostId!,
        newHostId: targetUserId,
      });
    }

    return jsonOk({ host_id: targetUserId, status: newStatus });
  } catch (err) { return jsonError(err); }
};

// Host releases the slot. Only the current host (or App Admin) can release.
// Releases the topic too — the user's mental model is "the slot goes back to
// open and available", which means a stranded topic (still pointing at
// this slot, status='scheduled') would contradict that. Symmetric to the
// claim-and-schedule DELETE path.
export const DELETE: APIRoute = async (ctx) => {
  try {
    const caller = requireUser(ctx);
    const slotId = ctx.params.id!;
    const db = getDb(ctx);

    const slot = await db.prepare('SELECT slate_id, host_id, topic_id, status FROM slots WHERE id = ?')
      .bind(slotId).first<{ slate_id: string; host_id: string | null; topic_id: string | null; status: string }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');

    const isCurrentHost = slot.host_id === caller.id;
    if (!isCurrentHost && !isAppAdmin(caller.scopes)) {
      throw new HttpError(403, 'forbidden');
    }

    const stmts = [
      db.prepare(
        `UPDATE slots SET host_id = NULL, topic_id = NULL, status = 'open' WHERE id = ?`,
      ).bind(slotId),
    ];
    if (slot.topic_id) {
      stmts.push(db.prepare(
        `UPDATE topics SET status = 'open', scheduled_slot_id = NULL, scheduled_at = NULL,
         scheduled_by = NULL WHERE id = ?`,
      ).bind(slot.topic_id));
    }
    await db.batch(stmts);

    await Enqueue.slotReleased(ctx, {
      slateId: slot.slate_id, actorId: caller.id, slotId, topicId: slot.topic_id,
    });

    return jsonOk({
      slot_id: slotId,
      slot_status: 'open',
      freed_topic_id: slot.topic_id,
    });
  } catch (err) { return jsonError(err); }
};
