import type { APIRoute } from 'astro';
import { getDb, now, randomId } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireSpeakerOnSlate } from '@/lib/access';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    await requireSpeakerOnSlate(ctx, slateId);
    const db = getDb(ctx);
    const { results } = await db.prepare(
      `SELECT id, name, cadence, days_of_week, nth_weekday, time_of_day, duration_minutes,
              start_date, end_date, active, created_at
       FROM slot_rules WHERE slate_id = ? ORDER BY created_at`,
    ).bind(slateId).all();
    return jsonOk({ rules: results });
  } catch (err) { return jsonError(err); }
};

export const POST: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    await requireSpeakerOnSlate(ctx, slateId);

    const body = await ctx.request.json() as {
      name?: string;
      cadence?: 'weekly' | 'monthly';
      days_of_week?: string;
      nth_weekday?: string;
      time_of_day?: string;
      duration_minutes?: number;
      start_date?: string;
      end_date?: string | null;
    };

    const cadence = body.cadence;
    if (cadence !== 'weekly' && cadence !== 'monthly') throw new HttpError(400, 'invalid_cadence');
    if (!validHHMM(body.time_of_day)) throw new HttpError(400, 'invalid_time_of_day');
    if (!validDate(body.start_date)) throw new HttpError(400, 'invalid_start_date');
    if (body.end_date && !validDate(body.end_date)) throw new HttpError(400, 'invalid_end_date');
    const duration = Number(body.duration_minutes);
    if (!Number.isInteger(duration) || duration < 1 || duration > 600) throw new HttpError(400, 'invalid_duration');

    if (cadence === 'weekly' && !validDaysOfWeek(body.days_of_week)) throw new HttpError(400, 'invalid_days_of_week');
    if (cadence === 'monthly' && !validNthWeekday(body.nth_weekday)) throw new HttpError(400, 'invalid_nth_weekday');

    const id = `rule_${randomId(8)}`;
    const db = getDb(ctx);
    await db.prepare(
      `INSERT INTO slot_rules (id, slate_id, name, cadence, days_of_week, nth_weekday,
                               time_of_day, duration_minutes, start_date, end_date, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).bind(
      id, slateId, body.name ?? null, cadence,
      cadence === 'weekly' ? body.days_of_week! : null,
      cadence === 'monthly' ? body.nth_weekday! : null,
      body.time_of_day!, duration, body.start_date!, body.end_date ?? null, now(),
    ).run();

    return jsonOk({ rule: { id } }, 201);
  } catch (err) { return jsonError(err); }
};

function validHHMM(s: string | undefined): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}
function validDate(s: string | undefined | null): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function validDaysOfWeek(s: string | undefined): boolean {
  if (typeof s !== 'string' || !s.trim()) return false;
  const allowed = new Set(['sun','mon','tue','wed','thu','fri','sat']);
  return s.split(',').every(t => allowed.has(t.trim().toLowerCase()));
}
function validNthWeekday(s: string | undefined): boolean {
  return typeof s === 'string' && /^-?\d+(sun|mon|tue|wed|thu|fri|sat)$/i.test(s);
}
