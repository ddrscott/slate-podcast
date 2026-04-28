import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { requireSpeakerOnSlate, jsonError } from '@/lib/access';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    await requireSpeakerOnSlate(ctx, slateId);
    const db = getDb(ctx);

    const slate = await db.prepare('SELECT name, slug, timezone FROM slates WHERE id = ?').bind(slateId)
      .first<{ name: string; slug: string; timezone: string }>();
    if (!slate) return new Response('Not found', { status: 404 });

    const rows = await db.prepare(
      `SELECT sl.id AS slot_id, sl.start_time, sl.duration_minutes, sl.status,
              sl.custom_title, sl.notes_internal, sl.show_notes, sl.show_notes_published_at, sl.rule_id,
              sl.speaker_id, su.email AS speaker_email,
              sug.id AS suggestion_id, sug.title AS suggestion_title, sug.description AS suggestion_description,
              sug.upvote_count, ua.email AS suggestion_author_email
       FROM slots sl
       LEFT JOIN users su ON su.id = sl.speaker_id
       LEFT JOIN suggestions sug ON sug.id = sl.suggestion_id
       LEFT JOIN users ua ON ua.id = sug.author_id
       WHERE sl.slate_id = ? ORDER BY sl.start_time`,
    ).bind(slateId).all<Record<string, unknown>>();

    const fmt = new Intl.DateTimeFormat('sv-SE', {
      timeZone: slate.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

    const headers = [
      'slot_id','date_local','time_local','duration_minutes','status',
      'speaker_email','custom_title','suggestion_id','suggestion_title',
      'suggestion_description','suggestion_author_email','upvote_count',
      'show_notes','show_notes_published','notes_internal','rule_id','start_time_unix',
    ];

    const lines: string[] = [headers.join(',')];
    for (const r of rows.results) {
      const localIso = fmt.format(new Date((r.start_time as number) * 1000));
      const [d, t] = localIso.split(' ');
      lines.push([
        r.slot_id, d, t, r.duration_minutes, r.status,
        r.speaker_email, r.custom_title, r.suggestion_id, r.suggestion_title,
        r.suggestion_description, r.suggestion_author_email, r.upvote_count,
        r.show_notes, r.show_notes_published_at ? '1' : '', r.notes_internal,
        r.rule_id, r.start_time,
      ].map(csvEscape).join(','));
    }

    const filename = `${slate.slug}-slots-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(lines.join('\n'), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) { return jsonError(err); }
};

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
