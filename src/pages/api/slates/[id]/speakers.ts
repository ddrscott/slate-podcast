import type { APIRoute } from 'astro';
import { getDb, now } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireAppAdmin } from '@/lib/access';

export const prerender = false;

// Promote a Member to Speaker. App Admin only.
// If the user isn't a member yet, they're inserted as a Speaker directly.
export const POST: APIRoute = async (ctx) => {
  try {
    const admin = requireAppAdmin(ctx);
    const slateId = ctx.params.id!;
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
    ).bind(slateId, userId, t, t, admin.id).run();

    return jsonOk({ user_id: userId, role: 'speaker' });
  } catch (err) { return jsonError(err); }
};
