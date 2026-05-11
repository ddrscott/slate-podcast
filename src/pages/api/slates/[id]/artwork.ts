import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireHostOnSlate } from '@/lib/access';
import { deleteImage, putImage, validateImage } from '@/lib/uploads';

export const prerender = false;

// Square (1:1) show artwork — the marquee centerpiece. Hosts on the slate
// (or App Admins) can upload/replace.
//
// The client computes a dominant accent color from the image at upload
// time and sends it as the `accent` form field (hex `#rrggbb`). It's
// best-effort: a missing or malformed value just leaves marquee_accent
// null so the marquee falls back to the default Signal Orange. We never
// reject the upload because color extraction failed in the browser.

const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;

export const POST: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    await requireHostOnSlate(ctx, slateId);

    const form = await ctx.request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'file_required');
    const err = validateImage(file);
    if (err) throw new HttpError(400, err);

    const accentRaw = form.get('accent');
    const accent = (typeof accentRaw === 'string' && ACCENT_RE.test(accentRaw))
      ? accentRaw.toLowerCase()
      : null;

    const db = getDb(ctx);
    const prev = await db.prepare(
      'SELECT artwork_image_url FROM slates WHERE id = ?',
    ).bind(slateId).first<{ artwork_image_url: string | null }>();
    if (!prev) throw new HttpError(404, 'slate_not_found');

    const { url } = await putImage(ctx, `slate-artwork/${slateId}`, file);
    await db.prepare(
      'UPDATE slates SET artwork_image_url = ?, marquee_accent = ? WHERE id = ?',
    ).bind(url, accent, slateId).run();

    if (prev.artwork_image_url && prev.artwork_image_url !== url) {
      ctx.locals.runtime?.ctx?.waitUntil?.(deleteImage(ctx, prev.artwork_image_url));
    }

    return jsonOk({ artwork_image_url: url, marquee_accent: accent }, 201);
  } catch (err) { return jsonError(err); }
};

export const DELETE: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    await requireHostOnSlate(ctx, slateId);

    const db = getDb(ctx);
    const prev = await db.prepare(
      'SELECT artwork_image_url FROM slates WHERE id = ?',
    ).bind(slateId).first<{ artwork_image_url: string | null }>();
    if (!prev) throw new HttpError(404, 'slate_not_found');

    await db.prepare(
      'UPDATE slates SET artwork_image_url = NULL, marquee_accent = NULL WHERE id = ?',
    ).bind(slateId).run();
    if (prev.artwork_image_url) {
      ctx.locals.runtime?.ctx?.waitUntil?.(deleteImage(ctx, prev.artwork_image_url));
    }
    return jsonOk();
  } catch (err) { return jsonError(err); }
};
