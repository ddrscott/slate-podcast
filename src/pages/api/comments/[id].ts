import type { APIRoute } from 'astro';
import { getDb, now } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireUser } from '@/lib/access';
import { isAppAdmin } from '@/lib/auth';

export const prerender = false;

// PATCH /api/comments/[id] — edit a comment's body. Author-only.
// Body: { body: string }
//
// DELETE /api/comments/[id] — soft-delete. Author OR slate admin OR
// App Admin can delete. Replies remain in the tree (parent_id keeps
// the structure); the UI renders deleted nodes as "[deleted]".

const MAX_BODY_LEN = 10_000;

async function loadCommentForAuth(ctx: Parameters<APIRoute>[0], commentId: string) {
  const db = getDb(ctx);
  const row = await db.prepare(
    `SELECT c.id, c.slate_id, c.author_id, c.deleted_at,
            sm.is_admin AS viewer_is_slate_admin
     FROM comments c
     LEFT JOIN slate_members sm
       ON sm.slate_id = c.slate_id AND sm.user_id = ?
     WHERE c.id = ?`,
  ).bind(ctx.locals.user?.id ?? '', commentId).first<{
    id: string; slate_id: string; author_id: string | null;
    deleted_at: number | null; viewer_is_slate_admin: number | null;
  }>();
  if (!row) throw new HttpError(404, 'comment_not_found');
  return row;
}

export const PATCH: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const commentId = ctx.params.id!;
    const row = await loadCommentForAuth(ctx, commentId);
    if (row.deleted_at) throw new HttpError(409, 'comment_deleted');
    if (row.author_id !== user.id) throw new HttpError(403, 'author_only');

    const raw = await ctx.request.json() as { body?: unknown };
    if (typeof raw.body !== 'string') throw new HttpError(400, 'invalid_body');
    const body = raw.body.trim();
    if (body.length === 0) throw new HttpError(400, 'empty_body');
    if (body.length > MAX_BODY_LEN) throw new HttpError(400, 'body_too_long');

    const t = now();
    const db = getDb(ctx);
    await db.prepare(
      'UPDATE comments SET body = ?, updated_at = ? WHERE id = ?',
    ).bind(body, t, commentId).run();

    return jsonOk({ updated_at: t });
  } catch (err) { return jsonError(err); }
};

export const DELETE: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const commentId = ctx.params.id!;
    const row = await loadCommentForAuth(ctx, commentId);
    if (row.deleted_at) return jsonOk({ already_deleted: true });

    const canDelete = row.author_id === user.id
      || !!row.viewer_is_slate_admin
      || isAppAdmin(user.scopes);
    if (!canDelete) throw new HttpError(403, 'not_allowed');

    const t = now();
    const db = getDb(ctx);
    await db.prepare(
      'UPDATE comments SET deleted_at = ? WHERE id = ?',
    ).bind(t, commentId).run();

    return jsonOk({ deleted_at: t });
  } catch (err) { return jsonError(err); }
};
