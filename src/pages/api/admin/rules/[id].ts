import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireSpeakerOnSlate } from '@/lib/access';

export const prerender = false;

async function loadRule(ctx: Parameters<APIRoute>[0], ruleId: string) {
  const db = getDb(ctx);
  const row = await db.prepare('SELECT id, slate_id FROM slot_rules WHERE id = ?')
    .bind(ruleId).first<{ id: string; slate_id: string }>();
  if (!row) throw new HttpError(404, 'not_found');
  await requireSpeakerOnSlate(ctx, row.slate_id);
  return row;
}

export const PATCH: APIRoute = async (ctx) => {
  try {
    const ruleId = ctx.params.id!;
    await loadRule(ctx, ruleId);
    const body = await ctx.request.json() as Record<string, unknown>;

    const fields: string[] = [];
    const values: unknown[] = [];
    const allowed = ['name','days_of_week','nth_weekday','time_of_day','duration_minutes','start_date','end_date','active'];
    for (const k of allowed) {
      if (k in body) {
        fields.push(`${k} = ?`);
        values.push(body[k]);
      }
    }
    if (fields.length === 0) throw new HttpError(400, 'nothing_to_update');
    values.push(ruleId);

    const db = getDb(ctx);
    await db.prepare(`UPDATE slot_rules SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    return jsonOk();
  } catch (err) { return jsonError(err); }
};

export const DELETE: APIRoute = async (ctx) => {
  try {
    const ruleId = ctx.params.id!;
    await loadRule(ctx, ruleId);
    const db = getDb(ctx);
    await db.prepare('DELETE FROM slot_rules WHERE id = ?').bind(ruleId).run();
    return jsonOk();
  } catch (err) { return jsonError(err); }
};
