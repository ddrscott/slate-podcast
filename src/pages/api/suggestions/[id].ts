import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireMemberOnSlate } from '@/lib/access';
import { displayName } from '@/lib/people';

export const prerender = false;

// GET a single suggestion's full detail. Used by the in-page detail panel
// so a viewer can read the description, tags, scheduled slot, etc. without
// leaving the slate index.
//
// Access: parent slate's `is_public` flag controls anonymous read. For
// private slates we fall back to the standard membership check.
export const GET: APIRoute = async (ctx) => {
  try {
    const id = ctx.params.id!;
    const db = getDb(ctx);

    const row = await db.prepare(
      `SELECT s.id, s.slate_id, s.title, s.description, s.url, s.tags,
              s.status, s.upvote_count, s.submitted_at,
              s.scheduled_slot_id, s.scheduled_at, s.scheduled_by,
              au.email AS author_email, au.display_name AS author_display_name, au.id AS author_id,
              sl.id AS slot_id, sl.start_time AS slot_start, sl.duration_minutes AS slot_duration,
              sl.status AS slot_status,
              spk.id AS speaker_id, spk.email AS speaker_email, spk.display_name AS speaker_display_name,
              slate.slug AS slate_slug, slate.timezone AS slate_timezone, slate.is_public AS slate_is_public
       FROM suggestions s
       JOIN users au ON au.id = s.author_id
       JOIN slates slate ON slate.id = s.slate_id
       LEFT JOIN slots sl ON sl.id = s.scheduled_slot_id
       LEFT JOIN users spk ON spk.id = sl.speaker_id
       WHERE s.id = ?`,
    ).bind(id).first<any>();
    if (!row) throw new HttpError(404, 'suggestion_not_found');

    if (!row.slate_is_public) {
      await requireMemberOnSlate(ctx, row.slate_id);
    }

    const user = ctx.locals.user;
    const has_voted = user
      ? !!(await db.prepare(
          'SELECT 1 FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?',
        ).bind(id, user.id).first<{ '1': number }>())
      : false;

    return jsonOk({
      suggestion: {
        id: row.id,
        slate_id: row.slate_id,
        slate_slug: row.slate_slug,
        slate_timezone: row.slate_timezone,
        title: row.title,
        description: row.description,
        url: row.url,
        tags: row.tags,
        status: row.status,
        upvote_count: row.upvote_count,
        submitted_at: row.submitted_at,
        has_voted,
        author: {
          id: row.author_id,
          email: row.author_email,
          name: displayName({ display_name: row.author_display_name, email: row.author_email }),
        },
        scheduled: row.slot_id ? {
          slot_id: row.slot_id,
          start_time: row.slot_start,
          duration_minutes: row.slot_duration,
          status: row.slot_status,
          speaker_id: row.speaker_id,
          speaker_email: row.speaker_email,
          speaker_name: displayName({ display_name: row.speaker_display_name, email: row.speaker_email }),
        } : null,
      },
    });
  } catch (err) { return jsonError(err); }
};
