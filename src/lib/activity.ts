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
//     await Enqueue.slotReleased(ctx, { slateId, actorId, slotId, topicId });
//
// And the activity page renders without ever asking "what kind is this?".

import type { APIContext } from 'astro';
import { getDb, now, randomId } from './db';
import { displayName } from './people';

export type ActivityKind =
  | 'member_joined'
  | 'host_promoted'
  | 'host_demoted'
  | 'host_substituted'    // one Host took over a slot from another
  | 'host_profile_edited' // host saved an edit to their wiki page
  | 'slate_admin_granted' // App Admin flipped is_admin=1 on a member
  | 'slate_admin_revoked' // App Admin flipped is_admin=0 on a member
  | 'topic_posted'
  | 'topic_archived'
  | 'topic_notes_edited'  // member/host saved an edit to a topic's notes
  | 'slot_claimed'        // host took a slot without a topic
  | 'slot_scheduled'
  | 'slot_unscheduled'
  | 'notes_published'
  | 'show_created'         // a new show was added to the slate
  | 'show_renamed'         // show's name was changed
  | 'show_wiki_edited'     // show's wiki body saved
  | 'show_slots_assigned'  // bulk assignment of slots to a show
  | 'topic_commented'      // member posted a comment / reply on a topic
  | 'slate_renamed';

export interface LogArgs {
  kind: ActivityKind;
  slateId: string;
  actorId?: string | null;
  topicId?: string | null;
  slotId?: string | null;
  targetUserId?: string | null;
  meta?: Record<string, unknown>;
}

export async function logActivity(ctx: APIContext, args: LogArgs): Promise<void> {
  try {
    const db = getDb(ctx);
    const id = `act_${randomId(10)}`;
    await db.prepare(
      `INSERT INTO activity (id, slate_id, actor_id, kind, topic_id, slot_id, target_user_id, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      args.slateId,
      args.actorId ?? null,
      args.kind,
      args.topicId ?? null,
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

  hostPromoted(ctx: APIContext, args: BaseArgs & { targetUserId: string }) {
    return logActivity(ctx, { kind: 'host_promoted', ...args });
  },

  hostDemoted(ctx: APIContext, args: BaseArgs & { targetUserId: string; self?: boolean }) {
    return logActivity(ctx, {
      kind: 'host_demoted',
      slateId: args.slateId,
      actorId: args.actorId,
      targetUserId: args.targetUserId,
      meta: args.self ? { self: true } : undefined,
    });
  },

  // Cooperative coverage: a Host takes over a slot another Host had.
  // target_user_id holds the *previous* host (the one covered for) so
  // the activity feed renders "actor subbed in for target" naturally.
  hostSubstituted(ctx: APIContext, args: BaseArgs & {
    slotId: string;
    topicId: string | null;
    previousHostId: string;
    newHostId: string;
  }) {
    return logActivity(ctx, {
      kind: 'host_substituted',
      slateId: args.slateId,
      actorId: args.actorId,
      slotId: args.slotId,
      topicId: args.topicId,
      targetUserId: args.previousHostId,
      meta: { new_host_id: args.newHostId },
    });
  },

  topicPosted(ctx: APIContext, args: BaseArgs & { topicId: string; title: string }) {
    return logActivity(ctx, {
      kind: 'topic_posted',
      slateId: args.slateId,
      actorId: args.actorId,
      topicId: args.topicId,
      meta: { title: args.title },
    });
  },

  topicArchived(ctx: APIContext, args: BaseArgs & { topicId: string }) {
    return logActivity(ctx, {
      kind: 'topic_archived',
      slateId: args.slateId,
      actorId: args.actorId,
      topicId: args.topicId,
    });
  },

  topicNotesEdited(ctx: APIContext, args: BaseArgs & { topicId: string; changeSummary?: string }) {
    return logActivity(ctx, {
      kind: 'topic_notes_edited',
      slateId: args.slateId,
      actorId: args.actorId,
      topicId: args.topicId,
      meta: args.changeSummary ? { change_summary: args.changeSummary } : undefined,
    });
  },

  // Host saved an edit to their wiki page on this slate. target_user_id
  // is the host whose page was edited — for self-edits actor === target,
  // for App-Admin edits they differ. The renderer reads target as the
  // page subject and actor as the editor.
  hostProfileEdited(ctx: APIContext, args: BaseArgs & {
    targetUserId: string;
    changeSummary?: string;
  }) {
    return logActivity(ctx, {
      kind: 'host_profile_edited',
      slateId: args.slateId,
      actorId: args.actorId,
      targetUserId: args.targetUserId,
      meta: args.changeSummary ? { change_summary: args.changeSummary } : undefined,
    });
  },

  // App Admin flipped is_admin on a slate_members row. Two kinds rather
  // than one with a sign so the activity feed reads naturally.
  slateAdminGranted(ctx: APIContext, args: BaseArgs & { targetUserId: string }) {
    return logActivity(ctx, {
      kind: 'slate_admin_granted',
      slateId: args.slateId,
      actorId: args.actorId,
      targetUserId: args.targetUserId,
    });
  },

  slateAdminRevoked(ctx: APIContext, args: BaseArgs & { targetUserId: string }) {
    return logActivity(ctx, {
      kind: 'slate_admin_revoked',
      slateId: args.slateId,
      actorId: args.actorId,
      targetUserId: args.targetUserId,
    });
  },

  // Bare claim — host takes an open slot without a topic. status flips
  // open → assigned. Topic-bearing claims still go through slotScheduled.
  slotClaimed(ctx: APIContext, args: BaseArgs & { slotId: string }) {
    return logActivity(ctx, {
      kind: 'slot_claimed',
      slateId: args.slateId,
      actorId: args.actorId,
      slotId: args.slotId,
    });
  },

  slotScheduled(ctx: APIContext, args: BaseArgs & {
    slotId: string;
    topicId: string;
    replacedTopicId?: string;
  }) {
    return logActivity(ctx, {
      kind: 'slot_scheduled',
      slateId: args.slateId,
      actorId: args.actorId,
      slotId: args.slotId,
      topicId: args.topicId,
      meta: args.replacedTopicId ? { replaced_topic_id: args.replacedTopicId } : undefined,
    });
  },

  // Slot unscheduled via the explicit "claim & schedule" undo path.
  slotUnscheduled(ctx: APIContext, args: BaseArgs & {
    slotId: string;
    topicId: string | null;
  }) {
    return logActivity(ctx, {
      kind: 'slot_unscheduled',
      slateId: args.slateId,
      actorId: args.actorId,
      slotId: args.slotId,
      topicId: args.topicId,
    });
  },

  // Slot released by its host (the "Release the slot" action). Same kind
  // as unschedule but tagged so the renderer can phrase it as "released".
  slotReleased(ctx: APIContext, args: BaseArgs & {
    slotId: string;
    topicId: string | null;
  }) {
    return logActivity(ctx, {
      kind: 'slot_unscheduled',
      slateId: args.slateId,
      actorId: args.actorId,
      slotId: args.slotId,
      topicId: args.topicId,
      meta: { release: true },
    });
  },

  // Topic detached from a confirmed slot but the slot retains its host.
  topicDetached(ctx: APIContext, args: BaseArgs & {
    slotId: string;
    topicId: string;
  }) {
    return logActivity(ctx, {
      kind: 'slot_unscheduled',
      slateId: args.slateId,
      actorId: args.actorId,
      slotId: args.slotId,
      topicId: args.topicId,
      meta: { topic_detached: true },
    });
  },

  notesPublished(ctx: APIContext, args: BaseArgs & {
    slotId: string;
    topicId: string | null;
  }) {
    return logActivity(ctx, {
      kind: 'notes_published',
      slateId: args.slateId,
      actorId: args.actorId,
      slotId: args.slotId,
      topicId: args.topicId,
    });
  },

  // ── Show events ─────────────────────────────────────────────────────────
  // show_id and show_name carried in meta — activity table doesn't have a
  // dedicated show_id column today, but renderers can read from meta.

  showCreated(ctx: APIContext, args: BaseArgs & { showId: string; showName: string }) {
    return logActivity(ctx, {
      kind: 'show_created',
      slateId: args.slateId,
      actorId: args.actorId,
      meta: { show_id: args.showId, show_name: args.showName },
    });
  },

  showRenamed(ctx: APIContext, args: BaseArgs & {
    showId: string; from: string; to: string;
  }) {
    return logActivity(ctx, {
      kind: 'show_renamed',
      slateId: args.slateId,
      actorId: args.actorId,
      meta: { show_id: args.showId, from: args.from, to: args.to },
    });
  },

  showWikiEdited(ctx: APIContext, args: BaseArgs & {
    showId: string; changeSummary?: string;
  }) {
    return logActivity(ctx, {
      kind: 'show_wiki_edited',
      slateId: args.slateId,
      actorId: args.actorId,
      meta: {
        show_id: args.showId,
        ...(args.changeSummary ? { change_summary: args.changeSummary } : {}),
      },
    });
  },

  // Bulk slot assignment to a show. count carries how many slots
  // actually changed hands (i.e., were not already pointing at this
  // show). The slate admin is the typical actor.
  showSlotsAssigned(ctx: APIContext, args: BaseArgs & {
    showId: string; showName: string; count: number;
  }) {
    return logActivity(ctx, {
      kind: 'show_slots_assigned',
      slateId: args.slateId,
      actorId: args.actorId,
      meta: { show_id: args.showId, show_name: args.showName, count: args.count },
    });
  },

  // Member posted a comment (or a reply) on a topic. `isReply` flips the
  // verb in the renderer ("commented" vs. "replied"). commentId is
  // stored on the activity row's meta in case future UI wants to deep-
  // link to the specific comment within the thread.
  topicCommented(ctx: APIContext, args: BaseArgs & {
    topicId: string;
    commentId: string;
    isReply: boolean;
  }) {
    return logActivity(ctx, {
      kind: 'topic_commented',
      slateId: args.slateId,
      actorId: args.actorId,
      topicId: args.topicId,
      meta: { comment_id: args.commentId, is_reply: args.isReply },
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
  topic_id: string | null;
  topic_title: string | null;
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
  | { type: 'topic'; href: string; title: string }
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
// Topic links point at the topic's detail page (`/[slate]/topics/[id]`),
// not the parent list page. Pass `commentAnchor` for events whose target
// is a specific comment within the topic's discussion thread — it appends
// `#cmt_<id>` so the browser scrolls straight to the comment on load.
const topicLink = (
  slug: string,
  topicId: string,
  title: string,
  commentAnchor?: string | null,
): Token => ({
  type: 'topic',
  href: `/${slug}/topics/${topicId}${commentAnchor ? `#${commentAnchor}` : ''}`,
  title,
});
const slotLink = (slug: string, slotId: string, label: string): Token =>
  ({ type: 'slot', href: `/${slug}/slot/${slotId}`, label });

// Shared trailing token sequence: "[on/for/·] {topic} [for/·] {slot}".
function topicAndSlot(
  r: ActivityRow,
  ctx: RenderContext,
  joinTopic: string,
  joinSlot: string,
): Token[] {
  const out: Token[] = [];
  if (r.topic_title && r.topic_id) {
    out.push(txt(joinTopic));
    out.push(topicLink(ctx.slug, r.topic_id, r.topic_title));
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

  host_promoted: (r) => [
    name(targetName(r)),
    txt(' was promoted to Host by '),
    name(actorName(r), 'secondary'),
  ],

  host_demoted: (r) => [
    name(targetName(r)),
    txt(r.meta.self ? ' stepped down to Member' : ' was demoted to Member by '),
    ...(r.meta.self ? [] : [name(actorName(r), 'secondary')]),
  ],

  host_substituted: (r, ctx) => [
    name(actorName(r)),
    txt(' subbed in for '),
    name(targetName(r)),
    ...topicAndSlot(r, ctx, ' on ', ' · '),
  ],

  topic_posted: (r, ctx) => [
    name(actorName(r)),
    txt(' suggested '),
    ...(r.topic_title && r.topic_id ? [topicLink(ctx.slug, r.topic_id, r.topic_title)] : []),
  ],

  topic_archived: (r, ctx) => [
    name(actorName(r)),
    txt(' archived '),
    ...(r.topic_title && r.topic_id ? [topicLink(ctx.slug, r.topic_id, r.topic_title)] : []),
  ],

  topic_notes_edited: (r, ctx) => [
    name(actorName(r)),
    txt(' edited notes on '),
    ...(r.topic_title && r.topic_id
      ? [topicLink(ctx.slug, r.topic_id, r.topic_title)]
      : [txt('a topic')]),
    ...(r.meta?.change_summary ? [txt(` — ${r.meta.change_summary}`)] : []),
  ],

  slate_admin_granted: (r) => [
    name(targetName(r)),
    txt(' was granted slate admin by '),
    name(actorName(r), 'secondary'),
  ],

  slate_admin_revoked: (r) => [
    name(targetName(r)),
    txt(' had slate admin revoked by '),
    name(actorName(r), 'secondary'),
  ],

  host_profile_edited: (r) => {
    // Self-edit (actor === target): "Bob edited their wiki page".
    // Cross-edit (admin editing someone else's): "Alice edited Bob's
    // wiki page". actor_id and target_user_id aren't both projected
    // onto ActivityRow today, but the names are — equality on the
    // *names* is the closest signal we have without joining ids in.
    const isSelf = !!r.actor_email && !!r.target_email && r.actor_email === r.target_email;
    if (isSelf) {
      return [
        name(actorName(r)),
        txt(' edited their wiki page'),
        ...(r.meta?.change_summary ? [txt(` — ${r.meta.change_summary}`)] : []),
      ];
    }
    return [
      name(actorName(r)),
      txt(' edited '),
      name(targetName(r)),
      txt("'s wiki page"),
      ...(r.meta?.change_summary ? [txt(` — ${r.meta.change_summary}`)] : []),
    ];
  },

  slot_claimed: (r, ctx) => [
    name(actorName(r)),
    txt(' claimed '),
    ...(r.slot_start && r.slot_id
      ? [slotLink(ctx.slug, r.slot_id, ctx.fmtSlotTime(r.slot_start))]
      : [txt('a slot')]),
    txt(' — no topic yet'),
  ],

  slot_scheduled: (r, ctx) => [
    name(actorName(r)),
    txt(r.meta.replaced_topic_id ? ' switched the topic to ' : ' scheduled '),
    ...(r.topic_title && r.topic_id ? [topicLink(ctx.slug, r.topic_id, r.topic_title)] : []),
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
      ...topicAndSlot(r, ctx, '', ' on '),
    ];
  },

  notes_published: (r, ctx) => [
    name(actorName(r)),
    txt(' published show notes for '),
    ...topicAndSlot(r, ctx, '', ' · '),
  ],

  slate_renamed: (r) => [
    name(actorName(r)),
    txt(' renamed the slate: '),
    { type: 'rename', from: String(r.meta.from ?? ''), to: String(r.meta.to ?? '') },
  ],

  show_created: (r) => [
    name(actorName(r)),
    txt(' added a new show: '),
    name(String(r.meta?.show_name ?? '(unnamed)')),
  ],

  show_renamed: (r) => [
    name(actorName(r)),
    txt(' renamed a show: '),
    { type: 'rename', from: String(r.meta?.from ?? ''), to: String(r.meta?.to ?? '') },
  ],

  show_wiki_edited: (r) => [
    name(actorName(r)),
    txt(' edited a show wiki'),
    ...(r.meta?.change_summary ? [txt(` — ${r.meta.change_summary}`)] : []),
  ],

  show_slots_assigned: (r) => [
    name(actorName(r)),
    txt(' assigned '),
    txt(`${r.meta?.count ?? '?'} slot${r.meta?.count === 1 ? '' : 's'}`),
    txt(' to '),
    name(String(r.meta?.show_name ?? 'a show')),
  ],

  topic_commented: (r, ctx) => {
    const commentId = typeof r.meta?.comment_id === 'string' ? r.meta.comment_id : null;
    // The activity row stores the bare id (e.g., "cmt_abc123"); the in-page
    // anchor on each comment is the same string. Just pass it through.
    const anchor = commentId || null;
    return [
      name(actorName(r)),
      txt(r.meta?.is_reply ? ' replied on ' : ' commented on '),
      ...(r.topic_title && r.topic_id
        ? [topicLink(ctx.slug, r.topic_id, r.topic_title, anchor)]
        : [txt('a topic')]),
    ];
  },
};

export function renderActivity(r: ActivityRow, ctx: RenderContext): Token[] {
  const fn = RENDERERS[r.kind];
  return fn ? fn(r, ctx) : [txt(r.kind)];
}
