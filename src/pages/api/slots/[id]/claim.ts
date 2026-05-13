import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireHostOnSlate, requireUser } from '@/lib/access';
import { isAppAdmin } from '@/lib/auth';
import { Enqueue } from '@/lib/activity';

export const prerender = false;

// Bare-claim a slot — host takes an open date without picking a topic
// yet. Topic-bearing claims still go through claim-and-schedule.
//
// Lifecycle:
//   POST    open  → assigned  (host_id = caller, topic_id stays null)
//   DELETE  assigned-with-no-topic → open  (host_id = null)
//
// We deliberately refuse to release a slot via DELETE if the slot has a
// topic or has progressed past 'assigned' — that's the existing
// "release the slot" flow on the topic side, which knows how to free
// the topic record too. This endpoint is *only* for the bare-claim
// arc, so its surface stays small and obvious.

export const POST: APIRoute = async (ctx) => {
  try {
    const slotId = ctx.params.id!;
    const user = requireUser(ctx);

    const db = getDb(ctx);
    const slot = await db.prepare(
      'SELECT slate_id, status, host_id, topic_id FROM slots WHERE id = ?',
    ).bind(slotId).first<{
      slate_id: string; status: string; host_id: string | null; topic_id: string | null;
    }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');

    await requireHostOnSlate(ctx, slot.slate_id);

    if (slot.status !== 'open') {
      // Already taken — either by the caller (idempotent), or someone
      // else (use assign-host to substitute), or further along the
      // lifecycle (use the appropriate flow).
      if (slot.host_id === user.id) {
        return jsonOk({ slot_id: slotId, status: slot.status }, 200);
      }
      throw new HttpError(409, 'slot_not_open');
    }

    await db.prepare(
      "UPDATE slots SET host_id = ?, status = 'assigned' WHERE id = ? AND status = 'open'",
    ).bind(user.id, slotId).run();

    await Enqueue.slotClaimed(ctx, {
      slateId: slot.slate_id,
      actorId: user.id,
      slotId,
    });

    return jsonOk({ slot_id: slotId, status: 'assigned' }, 201);
  } catch (err) { return jsonError(err); }
};

export const DELETE: APIRoute = async (ctx) => {
  try {
    const slotId = ctx.params.id!;
    const user = requireUser(ctx);

    const db = getDb(ctx);
    const slot = await db.prepare(
      'SELECT slate_id, status, host_id, topic_id FROM slots WHERE id = ?',
    ).bind(slotId).first<{
      slate_id: string; status: string; host_id: string | null; topic_id: string | null;
    }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');

    // Only the assigned host (or App Admin) can release.
    const isAdmin = isAppAdmin(user.scopes);
    if (slot.host_id !== user.id && !isAdmin) {
      throw new HttpError(403, 'not_the_assigned_host');
    }

    // This endpoint handles the bare-claim arc only. Slots with a topic
    // attached, or that have progressed past 'assigned', use the
    // existing release-the-slot path (claim-and-schedule DELETE).
    if (slot.status !== 'assigned' || slot.topic_id !== null) {
      throw new HttpError(409, 'use_release_slot_flow');
    }

    await db.prepare(
      "UPDATE slots SET host_id = NULL, status = 'open' WHERE id = ? AND status = 'assigned' AND topic_id IS NULL",
    ).bind(slotId).run();

    await Enqueue.slotReleased(ctx, {
      slateId: slot.slate_id,
      actorId: user.id,
      slotId,
      topicId: null,
    });

    return jsonOk({ slot_id: slotId, status: 'open' });
  } catch (err) { return jsonError(err); }
};
