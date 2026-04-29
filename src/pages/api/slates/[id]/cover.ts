import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireHostOnSlate } from '@/lib/access';
import { deleteImage, putImage, validateImage } from '@/lib/uploads';

export const prerender = false;

// Slate cover image — the marquee hero artwork rendered on the public
// landing page. Hosts on the slate (or App Admins) can upload/replace.

export const POST: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    await requireHostOnSlate(ctx, slateId);

    const form = await ctx.request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'file_required');
    const err = validateImage(file);
    if (err) throw new HttpError(400, err);

    const db = getDb(ctx);
    const prev = await db.prepare('SELECT cover_image_url FROM slates WHERE id = ?')
      .bind(slateId).first<{ cover_image_url: string | null }>();
    if (!prev) throw new HttpError(404, 'slate_not_found');

    const { url } = await putImage(ctx, `slate-covers/${slateId}`, file);
    await db.prepare('UPDATE slates SET cover_image_url = ? WHERE id = ?')
      .bind(url, slateId).run();

    if (prev.cover_image_url && prev.cover_image_url !== url) {
      ctx.locals.runtime?.ctx?.waitUntil?.(deleteImage(ctx, prev.cover_image_url));
    }

    return jsonOk({ cover_image_url: url }, 201);
  } catch (err) { return jsonError(err); }
};

export const DELETE: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    await requireHostOnSlate(ctx, slateId);

    const db = getDb(ctx);
    const prev = await db.prepare('SELECT cover_image_url FROM slates WHERE id = ?')
      .bind(slateId).first<{ cover_image_url: string | null }>();
    if (!prev) throw new HttpError(404, 'slate_not_found');

    await db.prepare('UPDATE slates SET cover_image_url = NULL WHERE id = ?')
      .bind(slateId).run();
    if (prev.cover_image_url) {
      ctx.locals.runtime?.ctx?.waitUntil?.(deleteImage(ctx, prev.cover_image_url));
    }
    return jsonOk();
  } catch (err) { return jsonError(err); }
};
