import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { jsonError, jsonOk, requireSpeakerOnSlate, requireUser } from '@/lib/access';

export const prerender = false;

// Returns the next ~30 slots a Speaker can claim-and-schedule against:
//  - status='open' (no speaker yet) — always available to take
//  - status='assigned' AND speaker_id=me AND no suggestion yet — own slots
//    that just need a topic
// Sorted by start_time, ascending. `start_time >= now - 1d` for clock-skew tolerance.
export const GET: APIRoute = async (ctx) => {
  try {
    const slateId = ctx.params.id!;
    await requireSpeakerOnSlate(ctx, slateId);
    const user = requireUser(ctx);

    const db = getDb(ctx);
    const slate = await db.prepare('SELECT timezone FROM slates WHERE id = ?').bind(slateId)
      .first<{ timezone: string }>();
    if (!slate) return jsonOk({ timezone: 'UTC', slots: [] });

    const nowSec = Math.floor(Date.now() / 1000);
    const { results } = await db.prepare(
      `SELECT id, start_time, duration_minutes, status, speaker_id, suggestion_id
       FROM slots
       WHERE slate_id = ?
         AND start_time >= ?
         AND status IN ('open','assigned')
         AND (status = 'open' OR (speaker_id = ? AND suggestion_id IS NULL))
       ORDER BY start_time
       LIMIT 30`,
    ).bind(slateId, nowSec - 86400, user.id).all<{
      id: string; start_time: number; duration_minutes: number; status: string;
      speaker_id: string | null; suggestion_id: string | null;
    }>();

    const slots = results.map(s => ({
      id: s.id,
      start_time: s.start_time,
      duration_minutes: s.duration_minutes,
      status: s.status,
      mine: s.speaker_id === user.id,
    }));

    return jsonOk({ timezone: slate.timezone, slots });
  } catch (err) { return jsonError(err); }
};
