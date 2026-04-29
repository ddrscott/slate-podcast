import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireUser } from '@/lib/access';

export const prerender = false;

// Update the signed-in user's profile fields. Only `display_name` for
// now; email is the JWT identity and isn't editable here.
//
// `display_name` accepts a trimmed string up to 80 chars, or `null` to
// clear it (revert to the email-local fallback rendered by displayName()).
export const PATCH: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const body = await ctx.request.json() as { display_name?: string | null };

    if (!('display_name' in body)) throw new HttpError(400, 'nothing_to_update');

    let next: string | null;
    if (body.display_name === null) {
      next = null;
    } else if (typeof body.display_name === 'string') {
      const trimmed = body.display_name.trim();
      if (trimmed.length === 0) {
        next = null;
      } else if (trimmed.length > 80) {
        throw new HttpError(400, 'display_name_too_long');
      } else {
        next = trimmed;
      }
    } else {
      throw new HttpError(400, 'invalid_display_name');
    }

    const db = getDb(ctx);
    await db.prepare('UPDATE users SET display_name = ? WHERE id = ?')
      .bind(next, user.id).run();

    return jsonOk({ display_name: next });
  } catch (err) { return jsonError(err); }
};
