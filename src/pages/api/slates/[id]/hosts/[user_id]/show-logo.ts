import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireCanEditHostOnSlate, requireUser } from '@/lib/access';
import { deleteImage, putImage, validateImage } from '@/lib/uploads';

export const prerender = false;

// Square show logo for a host on a slate. Modeled on
// /api/slates/[id]/cover and /api/me/headshot.
//
// Access: the host themselves, OR a slate admin on the slate, OR an
// App Admin (see requireCanEditHostOnSlate). Same auth rule as the
// show_name PATCH and the profile-body POST next door.

async function resolveTarget(ctx: Parameters<APIRoute>[0]) {
  const caller = requireUser(ctx);
  const slateId = ctx.params.id!;
  let targetUserId = ctx.params.user_id!;
  if (targetUserId === 'me') targetUserId = caller.id;

  await requireCanEditHostOnSlate(ctx, slateId, targetUserId);

  const db = getDb(ctx);
  const member = await db.prepare(
    'SELECT role, show_logo_url FROM slate_members WHERE slate_id = ? AND user_id = ?',
  ).bind(slateId, targetUserId).first<{ role: string; show_logo_url: string | null }>();
  if (!member) throw new HttpError(404, 'membership_not_found');
  if (member.role !== 'host') throw new HttpError(409, 'not_a_host');

  return { db, slateId, targetUserId, prev: member.show_logo_url };
}

export const POST: APIRoute = async (ctx) => {
  try {
    const { db, slateId, targetUserId, prev } = await resolveTarget(ctx);

    const form = await ctx.request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'file_required');
    const err = validateImage(file);
    if (err) throw new HttpError(400, err);

    const { url } = await putImage(ctx, `show-logos/${slateId}/${targetUserId}`, file);
    await db.prepare(
      'UPDATE slate_members SET show_logo_url = ? WHERE slate_id = ? AND user_id = ?',
    ).bind(url, slateId, targetUserId).run();

    if (prev && prev !== url) {
      ctx.locals.runtime?.ctx?.waitUntil?.(deleteImage(ctx, prev));
    }

    return jsonOk({ show_logo_url: url }, 201);
  } catch (err) { return jsonError(err); }
};

export const DELETE: APIRoute = async (ctx) => {
  try {
    const { db, slateId, targetUserId, prev } = await resolveTarget(ctx);
    await db.prepare(
      'UPDATE slate_members SET show_logo_url = NULL WHERE slate_id = ? AND user_id = ?',
    ).bind(slateId, targetUserId).run();
    if (prev) {
      ctx.locals.runtime?.ctx?.waitUntil?.(deleteImage(ctx, prev));
    }
    return jsonOk();
  } catch (err) { return jsonError(err); }
};
