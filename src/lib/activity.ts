// Per-slate activity log. Best-effort writes — a failed insert never blocks
// the underlying mutation (member-join, schedule, etc.) since notifications
// are not load-bearing. Caller passes the slate context + kind + optional
// subject FKs (suggestion_id, slot_id, target_user_id) and a free-form
// `meta` payload that's serialized as JSON.

import type { APIContext } from 'astro';
import { getDb, now, randomId } from './db';

export type ActivityKind =
  | 'member_joined'
  | 'speaker_promoted'
  | 'speaker_demoted'
  | 'speaker_substituted'   // one Speaker took over a slot from another
  | 'suggestion_posted'
  | 'suggestion_archived'
  | 'slot_scheduled'
  | 'slot_unscheduled'
  | 'notes_published'
  | 'slate_renamed';

export interface LogArgs {
  kind: ActivityKind;
  slateId: string;
  actorId?: string | null;
  suggestionId?: string | null;
  slotId?: string | null;
  targetUserId?: string | null;
  meta?: Record<string, unknown>;
}

export async function logActivity(ctx: APIContext, args: LogArgs): Promise<void> {
  try {
    const db = getDb(ctx);
    const id = `act_${randomId(10)}`;
    await db.prepare(
      `INSERT INTO activity (id, slate_id, actor_id, kind, suggestion_id, slot_id, target_user_id, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      args.slateId,
      args.actorId ?? null,
      args.kind,
      args.suggestionId ?? null,
      args.slotId ?? null,
      args.targetUserId ?? null,
      args.meta ? JSON.stringify(args.meta) : null,
      now(),
    ).run();
  } catch (err) {
    console.error('[activity] log failed (non-fatal)', args.kind, err);
  }
}
