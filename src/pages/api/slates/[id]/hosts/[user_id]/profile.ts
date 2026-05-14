import type { APIRoute } from 'astro';
import { getDb, now, randomId } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireCanEditHostOnSlate, requireUser } from '@/lib/access';
import { Enqueue } from '@/lib/activity';

export const prerender = false;

// Host wiki body (markdown). Same shape as POST /api/topics/[id]/notes:
// last-write-wins on slate_members.profile_body, every save also writes
// a slate_member_revisions row for attribution + history.
//
// Access: the host editing their own page, OR a slate admin on the
// slate, OR an App Admin (see requireCanEditHostOnSlate). Same auth rule
// as the show_name PATCH and show-logo endpoints.
//
// Body: { body: string, change_summary?: string }
//   body            — required, markdown, ≤ 100_000 chars
//   change_summary  — optional one-liner, ≤ 200 chars

const MAX_BODY_LEN = 100_000;
const MAX_SUMMARY_LEN = 200;

async function resolveTarget(ctx: Parameters<APIRoute>[0]) {
  const caller = requireUser(ctx);
  const slateId = ctx.params.id!;
  let targetUserId = ctx.params.user_id!;
  if (targetUserId === 'me') targetUserId = caller.id;

  await requireCanEditHostOnSlate(ctx, slateId, targetUserId);

  const db = getDb(ctx);
  const member = await db.prepare(
    'SELECT role FROM slate_members WHERE slate_id = ? AND user_id = ?',
  ).bind(slateId, targetUserId).first<{ role: string }>();
  if (!member) throw new HttpError(404, 'membership_not_found');
  if (member.role !== 'host') throw new HttpError(409, 'not_a_host');

  return { db, slateId, targetUserId, callerId: caller.id };
}

export const POST: APIRoute = async (ctx) => {
  try {
    const { db, slateId, targetUserId, callerId } = await resolveTarget(ctx);

    const raw = await ctx.request.json() as { body?: unknown; change_summary?: unknown };
    if (typeof raw.body !== 'string') throw new HttpError(400, 'invalid_body');
    const body = raw.body;
    if (body.length > MAX_BODY_LEN) throw new HttpError(400, 'body_too_long');

    let summary: string | null = null;
    if (raw.change_summary !== undefined && raw.change_summary !== null) {
      if (typeof raw.change_summary !== 'string') throw new HttpError(400, 'invalid_change_summary');
      const s = raw.change_summary.trim();
      if (s.length > MAX_SUMMARY_LEN) throw new HttpError(400, 'change_summary_too_long');
      summary = s === '' ? null : s;
    }

    const revId = `smr_${randomId(12)}`;
    const t = now();

    // Write revision first — if the second write fails we still have
    // history; the denormalized body just lags by one save.
    await db.prepare(
      `INSERT INTO slate_member_revisions
         (id, slate_id, user_id, body, author_id, change_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(revId, slateId, targetUserId, body, callerId, summary, t).run();

    await db.prepare(
      'UPDATE slate_members SET profile_body = ? WHERE slate_id = ? AND user_id = ?',
    ).bind(body, slateId, targetUserId).run();

    await Enqueue.hostProfileEdited(ctx, {
      slateId,
      actorId: callerId,
      targetUserId,
      changeSummary: summary ?? undefined,
    });

    return jsonOk({
      revision_id: revId,
      created_at: t,
      change_summary: summary,
    }, 201);
  } catch (err) { return jsonError(err); }
};

// GET — revision history (most recent first). Public read; the wiki body
// is public on the host page, so the history is too.
export const GET: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    let targetUserId = ctx.params.user_id!;
    if (targetUserId === 'me') {
      const u = ctx.locals.user;
      if (!u) throw new HttpError(401, 'unauthorized');
      targetUserId = u.id;
    }

    const db = getDb(ctx);
    const { results } = await db.prepare(
      `SELECT r.id, r.change_summary, r.created_at,
              u.email AS author_email, u.display_name AS author_display_name
       FROM slate_member_revisions r
       LEFT JOIN users u ON u.id = r.author_id
       WHERE r.slate_id = ? AND r.user_id = ?
       ORDER BY r.created_at DESC
       LIMIT 50`,
    ).bind(slateId, targetUserId).all();

    return jsonOk({ revisions: results });
  } catch (err) { return jsonError(err); }
};
