import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireUser } from '@/lib/access';

export const prerender = false;

// Update the signed-in user's profile fields. Email is the JWT identity
// and isn't editable here.
//
// All four editable fields accept a trimmed string within length bounds,
// or `null` to clear. The empty-string sentinel is also treated as clear,
// so the UI can submit `''` from a cleared input without special-casing.
//
//   display_name  : ≤  80 chars; null falls back to email-local part
//   tagline       : ≤ 140 chars; one-liner subhead under the name
//   bio           : ≤ 600 chars; 1–2 sentences for the marquee card
//   link          : ≤ 200 chars; must parse as http(s) URL
//
// PATCH is partial — fields not present in the body are left untouched.
export const PATCH: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const body = await ctx.request.json() as {
      display_name?: string | null;
      tagline?: string | null;
      bio?: string | null;
      link?: string | null;
    };

    const updates: { col: string; value: string | null }[] = [];

    if ('display_name' in body) {
      updates.push({ col: 'display_name', value: normalizeText(body.display_name, 80, 'display_name') });
    }
    if ('tagline' in body) {
      updates.push({ col: 'tagline', value: normalizeText(body.tagline, 140, 'tagline') });
    }
    if ('bio' in body) {
      updates.push({ col: 'bio', value: normalizeText(body.bio, 600, 'bio') });
    }
    if ('link' in body) {
      updates.push({ col: 'link', value: normalizeLink(body.link) });
    }

    if (updates.length === 0) throw new HttpError(400, 'nothing_to_update');

    const db = getDb(ctx);
    const setClause = updates.map(u => `${u.col} = ?`).join(', ');
    await db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`)
      .bind(...updates.map(u => u.value), user.id).run();

    return jsonOk(Object.fromEntries(updates.map(u => [u.col, u.value])));
  } catch (err) { return jsonError(err); }
};

function normalizeText(input: unknown, maxLen: number, fieldName: string): string | null {
  if (input === null) return null;
  if (typeof input !== 'string') throw new HttpError(400, `invalid_${fieldName}`);
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLen) throw new HttpError(400, `${fieldName}_too_long`);
  return trimmed;
}

function normalizeLink(input: unknown): string | null {
  if (input === null) return null;
  if (typeof input !== 'string') throw new HttpError(400, 'invalid_link');
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 200) throw new HttpError(400, 'link_too_long');
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { throw new HttpError(400, 'invalid_link'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(400, 'invalid_link');
  }
  return parsed.toString();
}
