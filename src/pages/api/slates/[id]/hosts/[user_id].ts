import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireAppAdmin, requireCanEditHostOnSlate, requireUser } from '@/lib/access';
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

// Edit a host's show identity, OR (App-Admin-only) flip their is_admin
// flag on this slate.
//
// Body shape: { show_name?: string | null, is_admin?: boolean }
//
//   show_name — ≤ 120 chars; null/empty clears (falls back to the
//               host's personal display_name on the marquee).
//               Auth: self, slate admin, or App Admin (via
//               requireCanEditHostOnSlate).
//   is_admin  — toggles slate-admin status. Target user is NOT
//               required to be a host (a slate admin can be a
//               'member' acting as a community manager). App Admin
//               only — keeps the chain of trust narrow.
//
// show_logo_url is set via POST /api/slates/[id]/hosts/[user_id]/show-logo
// (the R2 upload endpoint); it can be cleared by DELETE on that path.
export const PATCH: APIRoute = async (ctx) => {
  try {
    const caller = requireUser(ctx);
    const slateId = ctx.params.id!;
    let targetUserId = ctx.params.user_id!;
    if (targetUserId === 'me') targetUserId = caller.id;

    const body = await ctx.request.json() as { show_name?: string | null; is_admin?: boolean };
    const hasShowName = 'show_name' in body;
    const hasIsAdmin = 'is_admin' in body;
    if (!hasShowName && !hasIsAdmin) throw new HttpError(400, 'nothing_to_update');

    const db = getDb(ctx);
    const member = await db.prepare(
      'SELECT role, is_admin FROM slate_members WHERE slate_id = ? AND user_id = ?',
    ).bind(slateId, targetUserId).first<{ role: string; is_admin: number }>();
    if (!member) throw new HttpError(404, 'membership_not_found');

    const updates: { col: string; value: unknown }[] = [];

    if (hasShowName) {
      // show_name is host-only — a member with no show shouldn't have one.
      if (member.role !== 'host') throw new HttpError(409, 'not_a_host');
      await requireCanEditHostOnSlate(ctx, slateId, targetUserId);

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
      updates.push({ col: 'show_name', value: nextShowName });
    }

    if (hasIsAdmin) {
      // Granting/revoking slate-admin is App-Admin only. Keeps the
      // chain of trust narrow — a slate admin can't elevate someone
      // else (or themselves) to admin.
      requireAppAdmin(ctx);
      if (typeof body.is_admin !== 'boolean') throw new HttpError(400, 'invalid_is_admin');
      const next = body.is_admin ? 1 : 0;
      updates.push({ col: 'is_admin', value: next });

      // Activity entry for the flip — distinct kinds for granted vs
      // revoked so the feed reads naturally.
      if (next === 1 && member.is_admin === 0) {
        await Enqueue.slateAdminGranted(ctx, { slateId, actorId: caller.id, targetUserId });
      } else if (next === 0 && member.is_admin === 1) {
        await Enqueue.slateAdminRevoked(ctx, { slateId, actorId: caller.id, targetUserId });
      }
    }

    const setClause = updates.map(u => `${u.col} = ?`).join(', ');
    await db.prepare(
      `UPDATE slate_members SET ${setClause} WHERE slate_id = ? AND user_id = ?`,
    ).bind(...updates.map(u => u.value), slateId, targetUserId).run();

    return jsonOk(Object.fromEntries(updates.map(u => [u.col, u.value])));
  } catch (err) { return jsonError(err); }
};
