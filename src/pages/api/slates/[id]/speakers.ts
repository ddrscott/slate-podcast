import type { APIRoute } from 'astro';
import { getDb, now } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireSpeakerOnSlate, requireUser } from '@/lib/access';
import { Enqueue } from '@/lib/activity';

export const prerender = false;

// Promote a Member to Speaker. Allowed for any Speaker on the slate
// (or App Admin via the Speaker check's implicit pass-through). Promotion
// is additive, so peer-promote is the trust model — demotion stays
// App-Admin to avoid speaker-on-speaker coups.
//
// If the user isn't a member yet, they're inserted as a Speaker directly.
export const POST: APIRoute = async (ctx) => {
  try {
    const caller = requireUser(ctx);
    const slateId = ctx.params.id!;
    await requireSpeakerOnSlate(ctx, slateId);
    const body = await ctx.request.json() as { user_id?: string; email?: string };

    const db = getDb(ctx);
    const slate = await db.prepare('SELECT id FROM slates WHERE id = ?').bind(slateId).first();
    if (!slate) throw new HttpError(404, 'slate_not_found');

    let userId = body.user_id?.trim();
    if (!userId && body.email) {
      const u = await db.prepare('SELECT id FROM users WHERE email = ?')
        .bind(body.email.toLowerCase().trim()).first<{ id: string }>();
      if (!u) throw new HttpError(404, 'user_not_found');
      userId = u.id;
    }
    if (!userId) throw new HttpError(400, 'missing_user');

    const t = now();
    // Upsert: if member, promote; if absent, insert as speaker.
    await db.prepare(
      `INSERT INTO slate_members (slate_id, user_id, role, joined_at, promoted_at, promoted_by)
       VALUES (?, ?, 'speaker', ?, ?, ?)
       ON CONFLICT(slate_id, user_id) DO UPDATE SET
         role = 'speaker',
         promoted_at = excluded.promoted_at,
         promoted_by = excluded.promoted_by`,
    ).bind(slateId, userId, t, t, caller.id).run();

    await Enqueue.speakerPromoted(ctx, { slateId, actorId: caller.id, targetUserId: userId });

    return jsonOk({ user_id: userId, role: 'speaker' });
  } catch (err) { return jsonError(err); }
};
