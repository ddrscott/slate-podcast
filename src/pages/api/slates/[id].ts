import type { APIRoute } from 'astro';
import { getDb, slugify } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireSpeakerOnSlate, requireUser } from '@/lib/access';
import { logActivity } from '@/lib/activity';

export const prerender = false;

// PATCH a slate. Speakers (and App Admins) can edit.
export const PATCH: APIRoute = async (ctx) => {
  try {
    const caller = requireUser(ctx);
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

    let nameRename: { from: string; to: string } | null = null;

    const db = getDb(ctx);
    const existing = await db.prepare('SELECT name FROM slates WHERE id = ?')
      .bind(slateId).first<{ name: string }>();
    if (!existing) throw new HttpError(404, 'slate_not_found');

    if (typeof body.name === 'string') {
      const v = body.name.trim();
      if (!v || v.length > 120) throw new HttpError(400, 'invalid_name');
      fields.push('name = ?'); values.push(v);
      if (v !== existing.name) nameRename = { from: existing.name, to: v };
    }
    if (typeof body.slug === 'string') {
      // Always normalize — accept whatever the user typed and lowercase /
      // strip non-conforming chars. Reject only if nothing usable remains.
      const v = slugify(body.slug);
      if (!v || v.length < 2 || v.length > 64) {
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

    try {
      await db.prepare(`UPDATE slates SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    } catch (e: any) {
      if (String(e?.message ?? '').includes('UNIQUE')) throw new HttpError(409, 'slug_taken');
      throw e;
    }

    if (nameRename) {
      await logActivity(ctx, {
        kind: 'slate_renamed',
        slateId,
        actorId: caller.id,
        meta: nameRename,
      });
    }

    return jsonOk();
  } catch (err) { return jsonError(err); }
};
