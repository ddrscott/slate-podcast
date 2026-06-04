import type { APIRoute } from 'astro';
import { getDb, now, randomId } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireMemberOnSlate } from '@/lib/access';
import { Enqueue } from '@/lib/activity';

export const prerender = false;

// Collaborative pre-show notes — POST is last-write-wins.
// Saves the supplied body to topics.notes, appends a row to topic_revisions
// for attribution + history, and logs a topic_notes_edited activity event.
//
// Access: any member (or host, or App Admin) on the topic's slate. We
// resolve the slate from the topic_id so callers don't have to pass it.
//
// Body: { body: string, change_summary?: string }
//   body            — required, markdown, ≤ 1_000_000 chars (a hard upper
//                     bound that keeps a single revision row well under
//                     D1's 2 MB row limit while allowing a full corpus)
//   change_summary  — optional one-liner, ≤ 200 chars (think git commit
//                     message). Surfaces in the activity feed and on the
//                     revision row.

const MAX_BODY_LEN = 1_000_000;
const MAX_SUMMARY_LEN = 200;

export const POST: APIRoute = async (ctx) => {
  try {
    const topicId = ctx.params.id!;
    const db = getDb(ctx);

    // Resolve the topic + its slate so we can authorize against the slate.
    const topic = await db.prepare(
      'SELECT id, slate_id, title FROM topics WHERE id = ?',
    ).bind(topicId).first<{ id: string; slate_id: string; title: string }>();
    if (!topic) throw new HttpError(404, 'topic_not_found');

    await requireMemberOnSlate(ctx, topic.slate_id);
    const user = ctx.locals.user!;

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

    const revId = `tr_${randomId(12)}`;
    const t = now();

    // Write revision first so a partial failure leaves us with history
    // but a stale denormalized field — the safer side of inconsistency.
    await db.prepare(
      `INSERT INTO topic_revisions (id, topic_id, body, author_id, change_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(revId, topicId, body, user.id, summary, t).run();

    await db.prepare(
      'UPDATE topics SET notes = ? WHERE id = ?',
    ).bind(body, topicId).run();

    await Enqueue.topicNotesEdited(ctx, {
      slateId: topic.slate_id,
      actorId: user.id,
      topicId,
      changeSummary: summary ?? undefined,
    });

    return jsonOk({
      revision_id: revId,
      created_at: t,
      change_summary: summary,
    }, 201);
  } catch (err) { return jsonError(err); }
};

// GET — revision history (most recent first). Public read; the notes
// themselves are visible on the public topic page so the history is too.
export const GET: APIRoute = async (ctx) => {
  try {
    const topicId = ctx.params.id!;
    const db = getDb(ctx);
    const topic = await db.prepare(
      'SELECT id FROM topics WHERE id = ?',
    ).bind(topicId).first();
    if (!topic) throw new HttpError(404, 'topic_not_found');

    const { results } = await db.prepare(
      `SELECT r.id, r.body, r.change_summary, r.created_at,
              u.email AS author_email, u.display_name AS author_display_name
       FROM topic_revisions r
       LEFT JOIN users u ON u.id = r.author_id
       WHERE r.topic_id = ?
       ORDER BY r.created_at DESC
       LIMIT 50`,
    ).bind(topicId).all();

    return jsonOk({ revisions: results });
  } catch (err) { return jsonError(err); }
};
