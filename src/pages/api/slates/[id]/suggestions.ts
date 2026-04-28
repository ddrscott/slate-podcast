import type { APIRoute } from 'astro';
import { fingerprint, getDb, now, randomId } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireMemberOnSlate } from '@/lib/access';

export const prerender = false;

// List suggestions for a slate (signed-in members + speakers see all open ones,
// can filter by status). Sorted by upvote_count DESC then submitted_at DESC.
export const GET: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    await requireMemberOnSlate(ctx, slateId);

    const url = new URL(ctx.request.url);
    const status = url.searchParams.get('status') ?? 'open';
    if (!['open','scheduled','archived','all'].includes(status)) throw new HttpError(400, 'invalid_status');

    const db = getDb(ctx);
    const where = status === 'all' ? 's.slate_id = ?' : 's.slate_id = ? AND s.status = ?';
    const params: unknown[] = status === 'all' ? [slateId] : [slateId, status];

    const { results } = await db.prepare(
      `SELECT s.id, s.title, s.description, s.url, s.tags, s.status, s.upvote_count,
              s.submitted_at, s.scheduled_slot_id, s.scheduled_at,
              u.email AS author_email
       FROM suggestions s
       JOIN users u ON u.id = s.author_id
       WHERE ${where}
       ORDER BY s.upvote_count DESC, s.submitted_at DESC`,
    ).bind(...params).all();

    return jsonOk({ suggestions: results });
  } catch (err) { return jsonError(err); }
};

// Submit a suggestion. Members + Speakers + App Admins.
// Duplicate detection: if fingerprint matches an existing suggestion in the
// slate, return 409 with the duplicate (unless `?force=1`).
export const POST: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    await requireMemberOnSlate(ctx, slateId);
    const user = ctx.locals.user!;

    const url = new URL(ctx.request.url);
    const force = url.searchParams.get('force') === '1';

    const body = await ctx.request.json() as {
      title?: string;
      description?: string | null;
      url?: string | null;
      tags?: string | null;
    };

    const title = (body.title ?? '').trim();
    if (!title || title.length > 200) throw new HttpError(400, 'invalid_title');
    if (body.url && body.url.length > 500) throw new HttpError(400, 'invalid_url');
    const fp = fingerprint(title);
    if (!fp) throw new HttpError(400, 'invalid_title');

    const db = getDb(ctx);

    if (!force) {
      const dup = await db.prepare(
        `SELECT id, title, upvote_count, status FROM suggestions
         WHERE slate_id = ? AND fingerprint = ? LIMIT 1`,
      ).bind(slateId, fp).first<{ id: string; title: string; upvote_count: number; status: string }>();
      if (dup) {
        return Response.json({ ok: false, error: 'duplicate', duplicate: dup }, { status: 409 });
      }
    }

    const id = `sug_${randomId(10)}`;
    await db.prepare(
      `INSERT INTO suggestions (id, slate_id, author_id, title, description, url, tags,
                                status, fingerprint, upvote_count, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, 0, ?)`,
    ).bind(id, slateId, user.id, title, body.description ?? null, body.url ?? null,
           body.tags ?? null, fp, now()).run();

    return jsonOk({ suggestion: { id, title, fingerprint: fp } }, 201);
  } catch (err) { return jsonError(err); }
};
