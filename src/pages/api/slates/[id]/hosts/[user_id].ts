import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireAppAdmin, requireUser } from '@/lib/access';
import { Enqueue } from '@/lib/activity';

export const prerender = false;

// Demote a Host back to Member.
// Allowed if: caller is App Admin, OR caller is demoting themselves (target_id === 'me' or matches).
export const DELETE: APIRoute = async (ctx) => {
  try {
    const caller = requireUser(ctx);
    const slateId = ctx.params.id!;
    let targetUserId = ctx.params.user_id!;
    if (targetUserId === 'me') targetUserId = caller.id;

    const isSelfDemote = targetUserId === caller.id;
    if (!isSelfDemote) {
      // Promotion / demotion of others requires App Admin.
      requireAppAdmin(ctx);
    }

    const db = getDb(ctx);
    const row = await db.prepare(
      'SELECT role FROM slate_members WHERE slate_id = ? AND user_id = ?',
    ).bind(slateId, targetUserId).first<{ role: string }>();
    if (!row) throw new HttpError(404, 'membership_not_found');
    if (row.role !== 'host') throw new HttpError(409, 'not_a_host');

    await db.prepare(
      `UPDATE slate_members SET role = 'member', promoted_at = NULL, promoted_by = NULL
       WHERE slate_id = ? AND user_id = ?`,
    ).bind(slateId, targetUserId).run();

    await Enqueue.hostDemoted(ctx, {
      slateId, actorId: caller.id, targetUserId, self: isSelfDemote,
    });

    return jsonOk();
  } catch (err) { return jsonError(err); }
};
