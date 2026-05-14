import type { APIRoute } from 'astro';
import { getDb, slugify } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireHostOnSlate, requireUser } from '@/lib/access';
import { isAppAdmin } from '@/lib/auth';
import { Enqueue } from '@/lib/activity';

export const prerender = false;

// Edit show metadata. host-or-admin only. The show's host (the user
// whose user_id is shows.host_id) can edit. A slate admin can edit
// any show. App Admin can too.
//
// Body shape — all fields optional:
//   name              ≤ 120 chars
//   slug              regenerated with collision suffix on edit
//   description       ≤ 500 chars; null/empty clears
//   link              http(s) URL ≤ 500; null/empty clears
//   host_id           string user_id; admin-only (reassigning a show)
//   listen_apple_url  http(s); ≤ 500
//   listen_spotify_url
//   listen_youtube_url
//   listen_rss_url

const URL_RE = /^https?:\/\/.+/i;

async function loadShow(ctx: Parameters<APIRoute>[0]) {
  const slateId = ctx.params.id!;
  const showId = ctx.params.show_id!;
  const db = getDb(ctx);
  const show = await db.prepare(
    'SELECT id, slate_id, host_id, slug, name FROM shows WHERE id = ? AND slate_id = ?',
  ).bind(showId, slateId).first<{ id: string; slate_id: string; host_id: string | null; slug: string; name: string }>();
  if (!show) throw new HttpError(404, 'show_not_found');
  return { db, slateId, showId, show };
}

export const PATCH: APIRoute = async (ctx) => {
  try {
    const caller = requireUser(ctx);
    const { db, slateId, showId, show } = await loadShow(ctx);
    await requireHostOnSlate(ctx, slateId);

    const isAdmin = isAppAdmin(caller.scopes);
    // Only the show's host, a slate admin, or an App Admin can edit.
    // requireHostOnSlate already covers slate-admin + role=host; this
    // tightens "if you're a host but not THIS show's host, you can't
    // edit unless you're a slate admin / App Admin".
    if (show.host_id !== caller.id && !isAdmin) {
      const adminRow = await db.prepare(
        `SELECT 1 FROM slate_members WHERE slate_id = ? AND user_id = ? AND is_admin = 1`,
      ).bind(slateId, caller.id).first();
      if (!adminRow) throw new HttpError(403, 'not_show_host');
    }

    const body = await ctx.request.json() as {
      name?: string;
      slug?: string;
      description?: string | null;
      link?: string | null;
      host_id?: string;
      listen_apple_url?: string | null;
      listen_spotify_url?: string | null;
      listen_youtube_url?: string | null;
      listen_rss_url?: string | null;
    };

    const fields: string[] = [];
    const values: unknown[] = [];

    if ('name' in body) {
      const v = (body.name ?? '').trim();
      if (!v || v.length > 120) throw new HttpError(400, 'invalid_name');
      fields.push('name = ?'); values.push(v);
      if (v !== show.name) {
        await Enqueue.showRenamed(ctx, { slateId, actorId: caller.id, showId, from: show.name, to: v });
      }
    }

    if ('slug' in body && body.slug !== undefined) {
      let s = slugify((body.slug ?? '').trim());
      if (!s) throw new HttpError(400, 'invalid_slug');
      if (s.length > 64) s = s.slice(0, 64);
      if (s !== show.slug) {
        const existing = await db.prepare(
          `SELECT slug FROM shows WHERE slate_id = ? AND id != ? AND slug LIKE ?`,
        ).bind(slateId, showId, s + '%').all<{ slug: string }>();
        const used = new Set(existing.results.map(r => r.slug));
        if (used.has(s)) {
          let i = 2;
          while (used.has(`${s}-${i}`)) i++;
          s = `${s}-${i}`;
        }
      }
      fields.push('slug = ?'); values.push(s);
    }

    if ('description' in body) {
      const v = body.description === null || body.description === undefined
        ? null
        : String(body.description).trim() || null;
      if (v && v.length > 500) throw new HttpError(400, 'description_too_long');
      fields.push('description = ?'); values.push(v);
    }

    if ('link' in body) {
      const v = body.link === null || body.link === undefined
        ? null
        : String(body.link).trim() || null;
      if (v && (!URL_RE.test(v) || v.length > 500)) throw new HttpError(400, 'invalid_link');
      fields.push('link = ?'); values.push(v);
    }

    if ('host_id' in body && body.host_id) {
      // Admin-only — reassigning a show to a different host.
      if (!isAdmin) {
        const adminRow = await db.prepare(
          `SELECT 1 FROM slate_members WHERE slate_id = ? AND user_id = ? AND is_admin = 1`,
        ).bind(slateId, caller.id).first();
        if (!adminRow) throw new HttpError(403, 'reassign_requires_admin');
      }
      const target = await db.prepare(
        `SELECT 1 FROM slate_members WHERE slate_id = ? AND user_id = ? AND role = 'host'`,
      ).bind(slateId, body.host_id).first();
      if (!target) throw new HttpError(409, 'host_id_not_a_host');
      fields.push('host_id = ?'); values.push(body.host_id);
    }

    const listenFields: Array<[keyof typeof body, string]> = [
      ['listen_apple_url', 'invalid_apple_url'],
      ['listen_spotify_url', 'invalid_spotify_url'],
      ['listen_youtube_url', 'invalid_youtube_url'],
      ['listen_rss_url', 'invalid_rss_url'],
    ];
    for (const [key, errCode] of listenFields) {
      if (!(key in body)) continue;
      const raw = body[key] as string | null | undefined;
      if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
        fields.push(`${key} = ?`); values.push(null);
        continue;
      }
      const v = String(raw).trim();
      if (!URL_RE.test(v) || v.length > 500) throw new HttpError(400, errCode);
      fields.push(`${key} = ?`); values.push(v);
    }

    if (fields.length === 0) throw new HttpError(400, 'nothing_to_update');

    values.push(showId);
    await db.prepare(
      `UPDATE shows SET ${fields.join(', ')} WHERE id = ?`,
    ).bind(...values).run();

    return jsonOk({ updated: fields.length });
  } catch (err) { return jsonError(err); }
};
