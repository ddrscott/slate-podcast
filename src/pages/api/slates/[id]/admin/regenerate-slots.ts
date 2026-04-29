import type { APIRoute } from 'astro';
import { getDb, now, randomId } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireHostOnSlate } from '@/lib/access';
import { expandRule, type SlotRule } from '@/lib/recurrence';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    await requireHostOnSlate(ctx, slateId);

    const body = (await ctx.request.json().catch(() => ({}))) as { window_end?: string };
    const windowEnd = body.window_end ?? defaultHorizon();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(windowEnd)) throw new HttpError(400, 'invalid_window_end');

    const db = getDb(ctx);
    const slate = await db.prepare('SELECT timezone FROM slates WHERE id = ?').bind(slateId)
      .first<{ timezone: string }>();
    if (!slate) throw new HttpError(404, 'slate_not_found');

    const rules = await db.prepare(
      `SELECT id, cadence, days_of_week, nth_weekday, time_of_day, duration_minutes,
              start_date, end_date, active
       FROM slot_rules WHERE slate_id = ? AND active = 1`,
    ).bind(slateId).all<SlotRule>();

    const seen = new Set<number>();
    const candidates = rules.results.flatMap(r => expandRule(r, slate.timezone, windowEnd))
      .filter(s => {
        if (seen.has(s.start_time)) return false;
        seen.add(s.start_time);
        return true;
      });

    if (candidates.length === 0) {
      return jsonOk({ inserted: 0, skipped_existing: 0, total_candidates: 0 });
    }

    const CHUNK = 80;
    const existingSet = new Set<number>();
    for (let i = 0; i < candidates.length; i += CHUNK) {
      const slice = candidates.slice(i, i + CHUNK);
      const placeholders = slice.map(() => '?').join(',');
      const existing = await db.prepare(
        `SELECT start_time FROM slots WHERE slate_id = ? AND start_time IN (${placeholders})`,
      ).bind(slateId, ...slice.map(c => c.start_time)).all<{ start_time: number }>();
      for (const row of existing.results) existingSet.add(row.start_time);
    }

    const inserts = candidates.filter(c => !existingSet.has(c.start_time));
    const t = now();

    const BATCH = 50;
    for (let i = 0; i < inserts.length; i += BATCH) {
      const slice = inserts.slice(i, i + BATCH);
      const stmts = slice.map(s => db.prepare(
        `INSERT INTO slots (id, slate_id, rule_id, start_time, duration_minutes, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?)`,
      ).bind(`slot_${randomId(10)}`, slateId, s.rule_id, s.start_time, s.duration_minutes, t));
      await db.batch(stmts);
    }

    return jsonOk({
      inserted: inserts.length,
      skipped_existing: existingSet.size,
      total_candidates: candidates.length,
    });
  } catch (err) { return jsonError(err); }
};

function defaultHorizon(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 2);
  return d.toISOString().slice(0, 10);
}
