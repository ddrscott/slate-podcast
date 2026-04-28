import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireUser } from '@/lib/access';
import { deleteImage, putImage, validateImage } from '@/lib/uploads';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const form = await ctx.request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'file_required');
    const err = validateImage(file);
    if (err) throw new HttpError(400, err);

    const db = getDb(ctx);
    const prev = await db.prepare('SELECT headshot_url FROM users WHERE id = ?')
      .bind(user.id).first<{ headshot_url: string | null }>();

    const { url } = await putImage(ctx, `headshots/${user.id}`, file);
    await db.prepare('UPDATE users SET headshot_url = ? WHERE id = ?')
      .bind(url, user.id).run();

    // Best-effort cleanup of the previous image
    if (prev?.headshot_url && prev.headshot_url !== url) {
      ctx.locals.runtime?.ctx?.waitUntil?.(deleteImage(ctx, prev.headshot_url));
    }

    return jsonOk({ headshot_url: url }, 201);
  } catch (err) { return jsonError(err); }
};

export const DELETE: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const db = getDb(ctx);
    const prev = await db.prepare('SELECT headshot_url FROM users WHERE id = ?')
      .bind(user.id).first<{ headshot_url: string | null }>();
    await db.prepare('UPDATE users SET headshot_url = NULL WHERE id = ?')
      .bind(user.id).run();
    if (prev?.headshot_url) {
      ctx.locals.runtime?.ctx?.waitUntil?.(deleteImage(ctx, prev.headshot_url));
    }
    return jsonOk();
  } catch (err) { return jsonError(err); }
};
