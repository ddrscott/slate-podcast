import type { APIRoute } from 'astro';
import { getDb, slugify } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireSpeakerOnSlate } from '@/lib/access';

export const prerender = false;

// PATCH a slate. Speakers (and App Admins) can edit.
export const PATCH: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    await requireSpeakerOnSlate(ctx, slateId);

    const body = await ctx.request.json() as {
      name?: string;
      slug?: string;
      description?: string | null;
      timezone?: string;
      is_public?: boolean;
    };

    const fields: string[] = [];
    const values: unknown[] = [];

    if (typeof body.name === 'string') {
      const v = body.name.trim();
      if (!v || v.length > 120) throw new HttpError(400, 'invalid_name');
      fields.push('name = ?'); values.push(v);
    }
    if (typeof body.slug === 'string') {
      const v = (body.slug.trim() || slugify(body.slug));
      if (!v || v.length < 2 || v.length > 64 || !/^[a-z0-9][a-z0-9-]*$/.test(v)) {
        throw new HttpError(400, 'invalid_slug');
      }
      fields.push('slug = ?'); values.push(v);
    }
    if (body.description !== undefined) {
      fields.push('description = ?'); values.push(body.description);
    }
    if (typeof body.timezone === 'string') {
      try { new Intl.DateTimeFormat('en-US', { timeZone: body.timezone }); }
      catch { throw new HttpError(400, 'invalid_timezone'); }
      fields.push('timezone = ?'); values.push(body.timezone);
    }
    if (typeof body.is_public === 'boolean') {
      fields.push('is_public = ?'); values.push(body.is_public ? 1 : 0);
    }

    if (fields.length === 0) throw new HttpError(400, 'nothing_to_update');
    values.push(slateId);

    const db = getDb(ctx);
    try {
      await db.prepare(`UPDATE slates SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    } catch (e: any) {
      if (String(e?.message ?? '').includes('UNIQUE')) throw new HttpError(409, 'slug_taken');
      throw e;
    }
    return jsonOk();
  } catch (err) { return jsonError(err); }
};
