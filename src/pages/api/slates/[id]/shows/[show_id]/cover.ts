import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireHostOnSlate, requireUser } from '@/lib/access';
import { isAppAdmin } from '@/lib/auth';
import { deleteImage, putImage, validateImage } from '@/lib/uploads';

export const prerender = false;

// Square (1:1) show cover image. Modeled on /api/slates/[id]/artwork
// and /api/me/headshot.
// Access: show's host, slate admin, or App Admin.

async function authorize(ctx: Parameters<APIRoute>[0]) {
  const caller = requireUser(ctx);
  const slateId = ctx.params.id!;
  const showId = ctx.params.show_id!;
  await requireHostOnSlate(ctx, slateId);

  const db = getDb(ctx);
  const show = await db.prepare(
    'SELECT id, slate_id, host_id, cover_image_url FROM shows WHERE id = ? AND slate_id = ?',
  ).bind(showId, slateId).first<{ id: string; slate_id: string; host_id: string | null; cover_image_url: string | null }>();
  if (!show) throw new HttpError(404, 'show_not_found');

  if (show.host_id !== caller.id && !isAppAdmin(caller.scopes)) {
    const adminRow = await db.prepare(
      `SELECT 1 FROM slate_members WHERE slate_id = ? AND user_id = ? AND is_admin = 1`,
    ).bind(slateId, caller.id).first();
    if (!adminRow) throw new HttpError(403, 'not_show_host');
  }

  return { db, slateId, showId, prev: show.cover_image_url };
}

export const POST: APIRoute = async (ctx) => {
  try {
    const { db, slateId, showId, prev } = await authorize(ctx);
    const form = await ctx.request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'file_required');
    const err = validateImage(file);
    if (err) throw new HttpError(400, err);

    const { url } = await putImage(ctx, `show-covers/${slateId}/${showId}`, file);
    await db.prepare(
      'UPDATE shows SET cover_image_url = ? WHERE id = ?',
    ).bind(url, showId).run();

    if (prev && prev !== url) {
      ctx.locals.runtime?.ctx?.waitUntil?.(deleteImage(ctx, prev));
    }

    return jsonOk({ cover_image_url: url }, 201);
  } catch (err) { return jsonError(err); }
};

export const DELETE: APIRoute = async (ctx) => {
  try {
    const { db, showId, prev } = await authorize(ctx);
    await db.prepare(
      'UPDATE shows SET cover_image_url = NULL WHERE id = ?',
    ).bind(showId).run();
    if (prev) {
      ctx.locals.runtime?.ctx?.waitUntil?.(deleteImage(ctx, prev));
    }
    return jsonOk();
  } catch (err) { return jsonError(err); }
};
