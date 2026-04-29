import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireUser } from '@/lib/access';
import { isAppAdmin } from '@/lib/auth';
import { deleteImage, putImage, validateImage } from '@/lib/uploads';

export const prerender = false;

// Upload a promo image for a slot. Allowed: the slot's assigned host, any
// host on the slate, or an App Admin.
export const POST: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const slotId = ctx.params.id!;
    const form = await ctx.request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'file_required');
    const err = validateImage(file);
    if (err) throw new HttpError(400, err);

    const db = getDb(ctx);
    const slot = await db.prepare(
      `SELECT sl.slate_id, sl.host_id, sl.promo_image_url,
              (SELECT 1 FROM slate_members
                WHERE slate_id = sl.slate_id AND user_id = ? AND role = 'host') AS is_host
       FROM slots sl WHERE sl.id = ?`,
    ).bind(user.id, slotId).first<{ slate_id: string; host_id: string | null; promo_image_url: string | null; is_host: number | null }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');

    const allowed = slot.host_id === user.id || slot.is_host || isAppAdmin(user.scopes);
    if (!allowed) throw new HttpError(403, 'forbidden');

    const { url } = await putImage(ctx, `slots/${slotId}`, file);
    await db.prepare('UPDATE slots SET promo_image_url = ? WHERE id = ?')
      .bind(url, slotId).run();

    if (slot.promo_image_url && slot.promo_image_url !== url) {
      ctx.locals.runtime?.ctx?.waitUntil?.(deleteImage(ctx, slot.promo_image_url));
    }

    return jsonOk({ promo_image_url: url }, 201);
  } catch (err) { return jsonError(err); }
};

export const DELETE: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const slotId = ctx.params.id!;
    const db = getDb(ctx);
    const slot = await db.prepare(
      `SELECT sl.slate_id, sl.host_id, sl.promo_image_url,
              (SELECT 1 FROM slate_members
                WHERE slate_id = sl.slate_id AND user_id = ? AND role = 'host') AS is_host
       FROM slots sl WHERE sl.id = ?`,
    ).bind(user.id, slotId).first<{ slate_id: string; host_id: string | null; promo_image_url: string | null; is_host: number | null }>();
    if (!slot) throw new HttpError(404, 'slot_not_found');

    const allowed = slot.host_id === user.id || slot.is_host || isAppAdmin(user.scopes);
    if (!allowed) throw new HttpError(403, 'forbidden');

    await db.prepare('UPDATE slots SET promo_image_url = NULL WHERE id = ?')
      .bind(slotId).run();
    if (slot.promo_image_url) {
      ctx.locals.runtime?.ctx?.waitUntil?.(deleteImage(ctx, slot.promo_image_url));
    }
    return jsonOk();
  } catch (err) { return jsonError(err); }
};
