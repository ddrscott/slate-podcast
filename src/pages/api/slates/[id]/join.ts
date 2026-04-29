import type { APIRoute } from 'astro';
import { getDb, now } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireUser } from '@/lib/access';
import { Enqueue } from '@/lib/activity';

export const prerender = false;

// Open Member signup. Any signed-in user can join a public slate.
// Idempotent: re-joining a slate you're already in is a no-op.
export const POST: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const slateId = ctx.params.id!;
    const db = getDb(ctx);

    const slate = await db.prepare('SELECT id, is_public FROM slates WHERE id = ?').bind(slateId)
      .first<{ id: string; is_public: number }>();
    if (!slate) throw new HttpError(404, 'slate_not_found');
    if (!slate.is_public) throw new HttpError(403, 'slate_private');

    const existing = await db.prepare(
      'SELECT role FROM slate_members WHERE slate_id = ? AND user_id = ?',
    ).bind(slateId, user.id).first<{ role: string }>();

    if (existing) return jsonOk({ role: existing.role, already_member: true });

    await db.prepare(
      `INSERT INTO slate_members (slate_id, user_id, role, joined_at)
       VALUES (?, ?, 'member', ?)`,
    ).bind(slateId, user.id, now()).run();

    await Enqueue.memberJoined(ctx, { slateId, actorId: user.id });

    return jsonOk({ role: 'member' }, 201);
  } catch (err) { return jsonError(err); }
};
