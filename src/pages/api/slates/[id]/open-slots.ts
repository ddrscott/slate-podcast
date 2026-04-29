import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { jsonError, jsonOk, requireHostOnSlate, requireUser } from '@/lib/access';

export const prerender = false;

// Returns the next ~30 slots a Host can claim-and-schedule against:
//  - status='open' (no host yet) — always available to take
//  - status='assigned' AND host_id=me AND no topic yet — own slots
//    that just need a topic
// Sorted by start_time, ascending. `start_time >= now - 1d` for clock-skew tolerance.
export const GET: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    await requireHostOnSlate(ctx, slateId);
    const user = requireUser(ctx);

    const db = getDb(ctx);
    const slate = await db.prepare('SELECT timezone FROM slates WHERE id = ?').bind(slateId)
      .first<{ timezone: string }>();
    if (!slate) return jsonOk({ timezone: 'UTC', slots: [] });

    const nowSec = Math.floor(Date.now() / 1000);
    const { results } = await db.prepare(
      `SELECT id, start_time, duration_minutes, status, host_id, topic_id
       FROM slots
       WHERE slate_id = ?
         AND start_time >= ?
         AND status IN ('open','assigned')
         AND (status = 'open' OR (host_id = ? AND topic_id IS NULL))
       ORDER BY start_time
       LIMIT 30`,
    ).bind(slateId, nowSec - 86400, user.id).all<{
      id: string; start_time: number; duration_minutes: number; status: string;
      host_id: string | null; topic_id: string | null;
    }>();

    const slots = results.map(s => ({
      id: s.id,
      start_time: s.start_time,
      duration_minutes: s.duration_minutes,
      status: s.status,
      mine: s.host_id === user.id,
    }));

    return jsonOk({ timezone: slate.timezone, slots });
  } catch (err) { return jsonError(err); }
};
