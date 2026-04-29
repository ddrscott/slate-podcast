import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { HttpError, jsonError, jsonOk, requireHostOnSlate } from '@/lib/access';

export const prerender = false;

const ALLOWED_FIELDS = new Set(['status','custom_title','notes_internal','duration_minutes']);
const ALLOWED_STATUS = new Set(['open','assigned','confirmed','recorded','published','cancelled']);

interface RowDiff {
  id: string;
  changes: Record<string, unknown>;
}

export const POST: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    await requireHostOnSlate(ctx, slateId);

    const body = await ctx.request.json() as { diffs?: RowDiff[] };
    const diffs = Array.isArray(body.diffs) ? body.diffs : [];
    if (diffs.length === 0) throw new HttpError(400, 'no_diffs');
    if (diffs.length > 1000) throw new HttpError(400, 'too_many_diffs');

    const db = getDb(ctx);
    const stmts: D1PreparedStatement[] = [];

    for (const d of diffs) {
      if (typeof d.id !== 'string' || !d.id) throw new HttpError(400, 'invalid_diff_id');
      const fields: string[] = [];
      const values: unknown[] = [];

      for (const [k, v] of Object.entries(d.changes ?? {})) {
        if (!ALLOWED_FIELDS.has(k)) continue;
        if (k === 'status' && !ALLOWED_STATUS.has(String(v))) throw new HttpError(400, `invalid_status:${d.id}`);
        if (k === 'duration_minutes') {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1 || n > 600) throw new HttpError(400, `invalid_duration:${d.id}`);
        }
        fields.push(`${k} = ?`);
        values.push(v);
      }
      if (fields.length === 0) continue;
      values.push(d.id, slateId);
      stmts.push(db.prepare(
        `UPDATE slots SET ${fields.join(', ')} WHERE id = ? AND slate_id = ?`,
      ).bind(...values));
    }

    if (stmts.length === 0) return jsonOk({ updated: 0 });

    const BATCH = 50;
    let updated = 0;
    for (let i = 0; i < stmts.length; i += BATCH) {
      const slice = stmts.slice(i, i + BATCH);
      const results = await db.batch(slice);
      for (const r of results) updated += r.meta?.changes ?? 0;
    }
    return jsonOk({ updated });
  } catch (err) { return jsonError(err); }
};
