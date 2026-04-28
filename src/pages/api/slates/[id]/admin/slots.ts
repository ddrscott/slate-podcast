import type { APIRoute } from 'astro';
import { getDb, now, randomId } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireSpeakerOnSlate } from '@/lib/access';
import { zonedDateTimeToUnix } from '@/lib/recurrence';

export const prerender = false;

// Add a one-off slot (no rule binding).
export const POST: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    await requireSpeakerOnSlate(ctx, slateId);

    const body = await ctx.request.json() as {
      date?: string;
      time_of_day?: string;
      duration_minutes?: number;
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date ?? '')) throw new HttpError(400, 'invalid_date');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time_of_day ?? '')) throw new HttpError(400, 'invalid_time');
    const dur = Number(body.duration_minutes);
    if (!Number.isInteger(dur) || dur < 1 || dur > 600) throw new HttpError(400, 'invalid_duration');

    const db = getDb(ctx);
    const slate = await db.prepare('SELECT timezone FROM slates WHERE id = ?').bind(slateId)
      .first<{ timezone: string }>();
    if (!slate) throw new HttpError(404, 'slate_not_found');

    const [y, mo, d] = body.date!.split('-').map(Number);
    const [h, mi] = body.time_of_day!.split(':').map(Number);
    const startTime = zonedDateTimeToUnix(y, mo, d, h, mi, slate.timezone);

    const id = `slot_${randomId(10)}`;
    try {
      await db.prepare(
        `INSERT INTO slots (id, slate_id, rule_id, start_time, duration_minutes, status, created_at)
         VALUES (?, ?, NULL, ?, ?, 'open', ?)`,
      ).bind(id, slateId, startTime, dur, now()).run();
    } catch (e: any) {
      if (String(e?.message ?? '').includes('UNIQUE')) throw new HttpError(409, 'slot_exists');
      throw e;
    }

    return jsonOk({ slot: { id, start_time: startTime } }, 201);
  } catch (err) { return jsonError(err); }
};
