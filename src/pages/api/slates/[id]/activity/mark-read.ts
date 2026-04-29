import type { APIRoute } from 'astro';
import { getDb, now } from '@/lib/db';
import { jsonError, jsonOk, requireMemberOnSlate, requireUser } from '@/lib/access';

export const prerender = false;

// Bump the caller's per-(slate, user) watermark to the current time, so every
// activity row with `created_at <= now()` becomes "seen". Idempotent — last
// call wins.
export const POST: APIRoute = async (ctx) => {
  try {
    const user = requireUser(ctx);
    const slateId = ctx.params.id!;
    await requireMemberOnSlate(ctx, slateId);

    const t = now();
    const db = getDb(ctx);
    await db.prepare(
      `INSERT INTO activity_seen (user_id, slate_id, watermark_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, slate_id) DO UPDATE SET watermark_at = excluded.watermark_at`,
    ).bind(user.id, slateId, t).run();

    return jsonOk({ watermark_at: t });
  } catch (err) { return jsonError(err); }
};
