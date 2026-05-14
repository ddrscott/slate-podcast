import type { APIRoute } from 'astro';
import { getDb, now, randomId, slugify } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireHostOnSlate, requireUser } from '@/lib/access';

export const prerender = false;

// List shows on a slate. Public — listeners need this for the
// shows-grid on the marquee and for an archive view eventually.
export const GET: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    const db = getDb(ctx);
    const { results } = await db.prepare(
      `SELECT s.id, s.slug, s.name, s.description, s.cover_image_url,
              s.host_id, s.link, s.created_at,
              u.email AS host_email, u.display_name AS host_display_name,
              u.headshot_url AS host_headshot_url
       FROM shows s
       LEFT JOIN users u ON u.id = s.host_id
       WHERE s.slate_id = ?
       ORDER BY LOWER(s.name)`,
    ).bind(slateId).all();
    return jsonOk({ shows: results });
  } catch (err) { return jsonError(err); }
};

// Create a new show. host-or-admin only.
//   body: { name: string, host_id?: string, slug?: string,
//           description?: string, link?: string }
// `host_id` defaults to the caller (you create a show for yourself).
// `slug` defaults to slugify(name); collisions get a -2/-3 suffix.
export const POST: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    await requireHostOnSlate(ctx, slateId);
    const caller = requireUser(ctx);

    const body = await ctx.request.json() as {
      name?: string; host_id?: string; slug?: string;
      description?: string | null; link?: string | null;
    };
    const name = (body.name ?? '').trim();
    if (!name || name.length > 120) throw new HttpError(400, 'invalid_name');

    const hostId = body.host_id ?? caller.id;
    const description = body.description?.trim() || null;
    const link = body.link?.trim() || null;
    if (link && (!/^https?:\/\/.+/i.test(link) || link.length > 500)) {
      throw new HttpError(400, 'invalid_link');
    }

    const db = getDb(ctx);

    // Verify the chosen host is actually a host on this slate. (You
    // can't create a show for a member who hasn't been promoted.)
    const hostRow = await db.prepare(
      `SELECT role FROM slate_members WHERE slate_id = ? AND user_id = ? AND role = 'host'`,
    ).bind(slateId, hostId).first();
    if (!hostRow) throw new HttpError(409, 'host_id_not_a_host_on_this_slate');

    let slug = body.slug?.trim() ? slugify(body.slug.trim()) : slugify(name);
    if (!slug) throw new HttpError(400, 'invalid_slug');
    if (slug.length > 64) slug = slug.slice(0, 64);

    // Resolve slug collisions deterministically: -2, -3, ... within slate.
    const existing = await db.prepare(
      `SELECT slug FROM shows WHERE slate_id = ? AND slug LIKE ?`,
    ).bind(slateId, slug + '%').all<{ slug: string }>();
    const used = new Set(existing.results.map(r => r.slug));
    if (used.has(slug)) {
      let i = 2;
      while (used.has(`${slug}-${i}`)) i++;
      slug = `${slug}-${i}`;
    }

    const id = `show_${randomId(12)}`;
    await db.prepare(
      `INSERT INTO shows (id, slate_id, host_id, slug, name, description, link, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, slateId, hostId, slug, name, description, link, now()).run();

    return jsonOk({ id, slug, name, host_id: hostId }, 201);
  } catch (err) { return jsonError(err); }
};
