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

// Edit a host's show identity on this slate. Allowed for: the host
// themselves editing their own row, OR an App Admin editing anyone's.
//
// Body: { show_name?: string | null }
//   show_name  — ≤ 120 chars; null/empty clears (falls back to the
//                host's personal display_name on the marquee).
//
// show_logo_url is set via POST /api/slates/[id]/hosts/[user_id]/show-logo
// (the R2 upload endpoint); it can be cleared by DELETE on that path.
export const PATCH: APIRoute = async (ctx) => {
  try {
    const caller = requireUser(ctx);
    const slateId = ctx.params.id!;
    let targetUserId = ctx.params.user_id!;
    if (targetUserId === 'me') targetUserId = caller.id;

    if (targetUserId !== caller.id) {
      requireAppAdmin(ctx);
    }

    const db = getDb(ctx);
    const member = await db.prepare(
      'SELECT role FROM slate_members WHERE slate_id = ? AND user_id = ?',
    ).bind(slateId, targetUserId).first<{ role: string }>();
    if (!member) throw new HttpError(404, 'membership_not_found');
    if (member.role !== 'host') throw new HttpError(409, 'not_a_host');

    const body = await ctx.request.json() as { show_name?: string | null };
    if (!('show_name' in body)) throw new HttpError(400, 'nothing_to_update');

    let nextShowName: string | null;
    if (body.show_name === null) {
      nextShowName = null;
    } else if (typeof body.show_name === 'string') {
      const trimmed = body.show_name.trim();
      if (trimmed.length === 0) nextShowName = null;
      else if (trimmed.length > 120) throw new HttpError(400, 'show_name_too_long');
      else nextShowName = trimmed;
    } else {
      throw new HttpError(400, 'invalid_show_name');
    }

    await db.prepare(
      'UPDATE slate_members SET show_name = ? WHERE slate_id = ? AND user_id = ?',
    ).bind(nextShowName, slateId, targetUserId).run();

    return jsonOk({ show_name: nextShowName });
  } catch (err) { return jsonError(err); }
};
