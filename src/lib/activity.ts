// Per-slate activity log. Best-effort writes — a failed insert never blocks
// the underlying mutation (member-join, schedule, etc.) since notifications
// are not load-bearing.
//
// ─── Registering a new activity kind ─────────────────────────────────────
//
// 1. Add the literal to `ActivityKind`.
// 2. Add a renderer to `RENDERERS` that returns the tokens the feed should
//    show. This is the only place rendering lives — the activity page
//    iterates the registry, no per-kind branching in the JSX.
// 3. (Optional) Add a typed wrapper to `Enqueue` so call sites don't need
//    to remember the meta shape or the target_user_id convention. Skip it
//    for kinds whose required fields are obvious; add it whenever the
//    convention is non-trivial.
//
// That's the contract. Callers stay tiny:
//
//     await Enqueue.slotReleased(ctx, { slateId, actorId, slotId, suggestionId });
//
// And the activity page renders without ever asking "what kind is this?".

import type { APIContext } from 'astro';
import { getDb, now, randomId } from './db';
import { displayName } from './people';

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

// ── Typed call-site helpers ──────────────────────────────────────────────
// Each helper documents the required fields for that kind and encapsulates
// any non-obvious convention (e.g., target_user_id semantics for substitution).
// Callers are free to use logActivity() directly for one-offs, but Enqueue
// is the recommended path for anything load-bearing.

interface BaseArgs { slateId: string; actorId: string; }

export const Enqueue = {
  memberJoined(ctx: APIContext, args: BaseArgs) {
    return logActivity(ctx, { kind: 'member_joined', ...args });
  },

  speakerPromoted(ctx: APIContext, args: BaseArgs & { targetUserId: string }) {
    return logActivity(ctx, { kind: 'speaker_promoted', ...args });
  },

  speakerDemoted(ctx: APIContext, args: BaseArgs & { targetUserId: string; self?: boolean }) {
    return logActivity(ctx, {
      kind: 'speaker_demoted',
      slateId: args.slateId,
      actorId: args.actorId,
      targetUserId: args.targetUserId,
      meta: args.self ? { self: true } : undefined,
    });
  },

  // Cooperative coverage: a Speaker takes over a slot another Speaker had.
  // target_user_id holds the *previous* speaker (the one covered for) so
  // the activity feed renders "actor subbed in for target" naturally.
  speakerSubstituted(ctx: APIContext, args: BaseArgs & {
    slotId: string;
    suggestionId: string | null;
    previousSpeakerId: string;
    newSpeakerId: string;
  }) {
    return logActivity(ctx, {
      kind: 'speaker_substituted',
      slateId: args.slateId,
      actorId: args.actorId,
      slotId: args.slotId,
      suggestionId: args.suggestionId,
      targetUserId: args.previousSpeakerId,
      meta: { new_speaker_id: args.newSpeakerId },
    });
  },

  suggestionPosted(ctx: APIContext, args: BaseArgs & { suggestionId: string; title: string }) {
    return logActivity(ctx, {
      kind: 'suggestion_posted',
      slateId: args.slateId,
      actorId: args.actorId,
      suggestionId: args.suggestionId,
      meta: { title: args.title },
    });
  },

  suggestionArchived(ctx: APIContext, args: BaseArgs & { suggestionId: string }) {
    return logActivity(ctx, {
      kind: 'suggestion_archived',
      slateId: args.slateId,
      actorId: args.actorId,
      suggestionId: args.suggestionId,
    });
  },

  slotScheduled(ctx: APIContext, args: BaseArgs & {
    slotId: string;
    suggestionId: string;
    replacedSuggestionId?: string;
  }) {
    return logActivity(ctx, {
      kind: 'slot_scheduled',
      slateId: args.slateId,
      actorId: args.actorId,
      slotId: args.slotId,
      suggestionId: args.suggestionId,
      meta: args.replacedSuggestionId ? { replaced_suggestion_id: args.replacedSuggestionId } : undefined,
    });
  },

  // Slot unscheduled via the explicit "claim & schedule" undo path.
  slotUnscheduled(ctx: APIContext, args: BaseArgs & {
    slotId: string;
    suggestionId: string | null;
  }) {
    return logActivity(ctx, {
      kind: 'slot_unscheduled',
      slateId: args.slateId,
      actorId: args.actorId,
      slotId: args.slotId,
      suggestionId: args.suggestionId,
    });
  },

  // Slot released by its speaker (the "Release the slot" action). Same kind
  // as unschedule but tagged so the renderer can phrase it as "released".
  slotReleased(ctx: APIContext, args: BaseArgs & {
    slotId: string;
    suggestionId: string | null;
  }) {
    return logActivity(ctx, {
      kind: 'slot_unscheduled',
      slateId: args.slateId,
      actorId: args.actorId,
      slotId: args.slotId,
      suggestionId: args.suggestionId,
      meta: { release: true },
    });
  },

  // Topic detached from a confirmed slot but the slot retains its speaker.
  topicDetached(ctx: APIContext, args: BaseArgs & {
    slotId: string;
    suggestionId: string;
  }) {
    return logActivity(ctx, {
      kind: 'slot_unscheduled',
      slateId: args.slateId,
      actorId: args.actorId,
      slotId: args.slotId,
      suggestionId: args.suggestionId,
      meta: { topic_detached: true },
    });
  },

  notesPublished(ctx: APIContext, args: BaseArgs & {
    slotId: string;
    suggestionId: string | null;
  }) {
    return logActivity(ctx, {
      kind: 'notes_published',
      slateId: args.slateId,
      actorId: args.actorId,
      slotId: args.slotId,
      suggestionId: args.suggestionId,
    });
  },

  slateRenamed(ctx: APIContext, args: BaseArgs & { from: string; to: string }) {
    return logActivity(ctx, {
      kind: 'slate_renamed',
      slateId: args.slateId,
      actorId: args.actorId,
      meta: { from: args.from, to: args.to },
    });
  },
};

// ── Renderer registry ────────────────────────────────────────────────────
// Each kind returns a flat list of tokens. The activity page maps tokens
// to span/anchor elements via a single Astro component; no per-kind JSX
// branching anywhere.

export interface ActivityRow {
  id: string;
  kind: ActivityKind;
  created_at: number;
  actor_email: string | null;
  actor_display_name: string | null;
  target_email: string | null;
  target_display_name: string | null;
  suggestion_id: string | null;
  suggestion_title: string | null;
  slot_id: string | null;
  slot_start: number | null;
  meta: Record<string, any>;
}

export interface RenderContext {
  slug: string;
  fmtSlotTime: (sec: number) => string;
}

export type Token =
  | { type: 'text'; value: string }
  | { type: 'name'; value: string; opacity?: 'primary' | 'secondary' }
  | { type: 'suggestion'; href: string; title: string }
  | { type: 'slot'; href: string; label: string }
  | { type: 'rename'; from: string; to: string };

const actorName = (r: ActivityRow): string =>
  r.actor_email
    ? displayName({ display_name: r.actor_display_name, email: r.actor_email })
    : 'someone';
const targetName = (r: ActivityRow): string =>
  r.target_email
    ? displayName({ display_name: r.target_display_name, email: r.target_email })
    : '(unknown)';

// Composable token builders so renderers stay short.
const txt = (value: string): Token => ({ type: 'text', value });
const name = (value: string, opacity?: 'primary' | 'secondary'): Token =>
  ({ type: 'name', value, opacity });
const suggestionLink = (slug: string, title: string): Token =>
  ({ type: 'suggestion', href: `/${slug}/suggestions`, title });
const slotLink = (slug: string, slotId: string, label: string): Token =>
  ({ type: 'slot', href: `/${slug}/slot/${slotId}`, label });

// Shared trailing token sequence: "[on/for/·] {suggestion} [for/·] {slot}".
function suggestionAndSlot(
  r: ActivityRow,
  ctx: RenderContext,
  joinSuggestion: string,
  joinSlot: string,
): Token[] {
  const out: Token[] = [];
  if (r.suggestion_title) {
    out.push(txt(joinSuggestion));
    out.push(suggestionLink(ctx.slug, r.suggestion_title));
  }
  if (r.slot_start && r.slot_id) {
    out.push(txt(joinSlot));
    out.push(slotLink(ctx.slug, r.slot_id, ctx.fmtSlotTime(r.slot_start)));
  }
  return out;
}

const RENDERERS: Record<ActivityKind, (r: ActivityRow, ctx: RenderContext) => Token[]> = {
  member_joined: (r) => [
    name(actorName(r)),
    txt(' joined as a Member'),
  ],

  speaker_promoted: (r) => [
    name(targetName(r)),
    txt(' was promoted to Speaker by '),
    name(actorName(r), 'secondary'),
  ],

  speaker_demoted: (r) => [
    name(targetName(r)),
    txt(r.meta.self ? ' stepped down to Member' : ' was demoted to Member by '),
    ...(r.meta.self ? [] : [name(actorName(r), 'secondary')]),
  ],

  speaker_substituted: (r, ctx) => [
    name(actorName(r)),
    txt(' subbed in for '),
    name(targetName(r)),
    ...suggestionAndSlot(r, ctx, ' on ', ' · '),
  ],

  suggestion_posted: (r, ctx) => [
    name(actorName(r)),
    txt(' suggested '),
    ...(r.suggestion_title ? [suggestionLink(ctx.slug, r.suggestion_title)] : []),
  ],

  suggestion_archived: (r, ctx) => [
    name(actorName(r)),
    txt(' archived '),
    ...(r.suggestion_title ? [suggestionLink(ctx.slug, r.suggestion_title)] : []),
  ],

  slot_scheduled: (r, ctx) => [
    name(actorName(r)),
    txt(r.meta.replaced_suggestion_id ? ' switched the topic to ' : ' scheduled '),
    ...(r.suggestion_title ? [suggestionLink(ctx.slug, r.suggestion_title)] : []),
    ...(r.slot_start && r.slot_id ? [
      txt(' for '),
      slotLink(ctx.slug, r.slot_id, ctx.fmtSlotTime(r.slot_start)),
    ] : []),
  ],

  slot_unscheduled: (r, ctx) => {
    const verb = r.meta.release ? ' released '
               : r.meta.topic_detached ? ' detached the topic '
               : ' unscheduled ';
    return [
      name(actorName(r)),
      txt(verb),
      ...suggestionAndSlot(r, ctx, '', ' on '),
    ];
  },

  notes_published: (r, ctx) => [
    name(actorName(r)),
    txt(' published show notes for '),
    ...suggestionAndSlot(r, ctx, '', ' · '),
  ],

  slate_renamed: (r) => [
    name(actorName(r)),
    txt(' renamed the slate: '),
    { type: 'rename', from: String(r.meta.from ?? ''), to: String(r.meta.to ?? '') },
  ],
};

export function renderActivity(r: ActivityRow, ctx: RenderContext): Token[] {
  const fn = RENDERERS[r.kind];
  return fn ? fn(r, ctx) : [txt(r.kind)];
}
