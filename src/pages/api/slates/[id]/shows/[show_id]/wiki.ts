import type { APIRoute } from 'astro';
import { getDb, now, randomId } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireHostOnSlate, requireUser } from '@/lib/access';
import { isAppAdmin } from '@/lib/auth';
import { Enqueue } from '@/lib/activity';

export const prerender = false;

// Show wiki body (markdown). Last-write-wins on shows.wiki_body; every
// save also writes a show_revisions row.
//
// Access: the show's host, OR a slate admin, OR App Admin.
//
// Body: { body: string, change_summary?: string }

const MAX_BODY_LEN = 100_000;
const MAX_SUMMARY_LEN = 200;

async function authorize(ctx: Parameters<APIRoute>[0]) {
  const caller = requireUser(ctx);
  const slateId = ctx.params.id!;
  const showId = ctx.params.show_id!;
  await requireHostOnSlate(ctx, slateId);

  const db = getDb(ctx);
  const show = await db.prepare(
    'SELECT id, slate_id, host_id, name FROM shows WHERE id = ? AND slate_id = ?',
  ).bind(showId, slateId).first<{ id: string; slate_id: string; host_id: string | null; name: string }>();
  if (!show) throw new HttpError(404, 'show_not_found');

  // Show host can edit own wiki. Slate admin / App Admin can edit any.
  if (show.host_id !== caller.id && !isAppAdmin(caller.scopes)) {
    const adminRow = await db.prepare(
      `SELECT 1 FROM slate_members WHERE slate_id = ? AND user_id = ? AND is_admin = 1`,
    ).bind(slateId, caller.id).first();
    if (!adminRow) throw new HttpError(403, 'not_show_host');
  }

  return { db, slateId, showId, callerId: caller.id, show };
}

export const POST: APIRoute = async (ctx) => {
  try {
    const { db, slateId, showId, callerId } = await authorize(ctx);

    const raw = await ctx.request.json() as { body?: unknown; change_summary?: unknown };
    if (typeof raw.body !== 'string') throw new HttpError(400, 'invalid_body');
    if (raw.body.length > MAX_BODY_LEN) throw new HttpError(400, 'body_too_long');

    let summary: string | null = null;
    if (raw.change_summary !== undefined && raw.change_summary !== null) {
      if (typeof raw.change_summary !== 'string') throw new HttpError(400, 'invalid_change_summary');
      const s = raw.change_summary.trim();
      if (s.length > MAX_SUMMARY_LEN) throw new HttpError(400, 'change_summary_too_long');
      summary = s === '' ? null : s;
    }

    const revId = `srv_${randomId(12)}`;
    const t = now();

    await db.prepare(
      `INSERT INTO show_revisions (id, show_id, body, author_id, change_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(revId, showId, raw.body, callerId, summary, t).run();

    await db.prepare(
      'UPDATE shows SET wiki_body = ? WHERE id = ?',
    ).bind(raw.body, showId).run();

    await Enqueue.showWikiEdited(ctx, {
      slateId, actorId: callerId, showId, changeSummary: summary ?? undefined,
    });

    return jsonOk({ revision_id: revId, created_at: t, change_summary: summary }, 201);
  } catch (err) { return jsonError(err); }
};

// GET — revision history (most recent first).
export const GET: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    const showId = ctx.params.show_id!;
    const db = getDb(ctx);
    const show = await db.prepare(
      'SELECT id FROM shows WHERE id = ? AND slate_id = ?',
    ).bind(showId, slateId).first();
    if (!show) throw new HttpError(404, 'show_not_found');

    const { results } = await db.prepare(
      `SELECT r.id, r.change_summary, r.created_at,
              u.email AS author_email, u.display_name AS author_display_name
       FROM show_revisions r
       LEFT JOIN users u ON u.id = r.author_id
       WHERE r.show_id = ?
       ORDER BY r.created_at DESC
       LIMIT 50`,
    ).bind(showId).all();

    return jsonOk({ revisions: results });
  } catch (err) { return jsonError(err); }
};
