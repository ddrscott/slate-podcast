import type { APIRoute } from 'astro';
import { getDb, now, randomId, slugify } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireAppAdmin } from '@/lib/access';

export const prerender = false;

// Create a slate. App Admin only.
export const POST: APIRoute = async (ctx) => {
  try {
    const admin = requireAppAdmin(ctx);
    const body = await ctx.request.json() as {
      name?: string;
      slug?: string;
      description?: string;
      timezone?: string;
    };
    const name = (body.name ?? '').trim();
    if (!name || name.length > 120) throw new HttpError(400, 'invalid_name');
    // Normalize whatever the user typed — fall back to slugifying the name
    // if the slug field is empty.
    const slug = slugify(body.slug ?? '') || slugify(name);
    if (!slug || slug.length < 2 || slug.length > 64) throw new HttpError(400, 'invalid_slug');
    const tz = (body.timezone ?? 'America/Chicago').trim();
    if (!isValidTimezone(tz)) throw new HttpError(400, 'invalid_timezone');

    const db = getDb(ctx);
    const dup = await db.prepare('SELECT id FROM slates WHERE slug = ?').bind(slug).first();
    if (dup) throw new HttpError(409, 'slug_taken');

    const id = `slt_${randomId(8)}`;
    await db.prepare(
      `INSERT INTO slates (id, slug, name, description, timezone, is_public, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(id, slug, name, body.description ?? null, tz, admin.id, now()).run();

    return jsonOk({ slate: { id, slug, name, timezone: tz } }, 201);
  } catch (err) { return jsonError(err); }
};

function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
