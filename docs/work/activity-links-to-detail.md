# Activity links should point to the specific detail page, not the parent category

## Problem

On `/[slate]/activity`, the activity feed renders topic-related events as links to `/[slate]/topics` (the topic LIST page). That's the parent category, not the specific item that changed. A user clicking "Bob commented on Topic X" expects to land on Topic X — and for comment events, specifically on the comment Bob just posted.

Concretely: `src/lib/activity.ts` defines `topicLink(slug, title)` returning `{ href: \`/${slug}/topics\` }`. Every renderer that links a topic (`topic_posted`, `topic_archived`, `topic_notes_edited`, `topic_commented`, `slot_scheduled`, `slot_unscheduled`, `notes_published`, `host_substituted`) uses this builder and therefore inherits the wrong URL.

The `activity` table already stores `topic_id` on each row, so the data needed to build the correct URL is already in the renderer's input. The fix is in the renderer registry, not the schema.

## Acceptance Criteria

- **Topic-related activity rows** link to `/[slate]/topics/{topic_id}` instead of `/[slate]/topics`. All activity kinds that use `topicLink` get this fix.
- **Comment-posted activity rows** (`topic_commented`) deep-link to the specific comment: `/[slate]/topics/{topic_id}#cmt_{comment_id}`. The `comment_id` is already stored in `activity.meta.comment_id` (see `Enqueue.topicCommented` in `src/lib/activity.ts`). Browser scrolls to the comment on load.
- **`Comment.astro` exposes an `id` anchor on each rendered comment.** Currently it has `data-comment-id="cmt_..."` but no DOM `id`. Add `id={\`cmt_${comment.id}\`}` to the `<article>` so anchor scrolling works.
- **Slot links keep working as they are** — `slotLink` already returns `/slot/{slotId}` which is the detail page. No change needed there.

## Relevant Files

- `src/lib/activity.ts` — `topicLink()` builder + Token type. `topic_commented` renderer needs to also surface `comment_id` so the link can include the anchor.
- `src/components/Comment.astro` — add `id={\`cmt_${comment.id}\`}` to the `<article>` element.
- `src/components/ActivityTokens.astro` — the component that maps tokens to anchor elements. May need a new token type (`topic-with-anchor` or extending `topic` to carry an optional anchor), or `topic` token's `href` field can just be widened to include the fragment.

## Constraints

- **Don't break the existing token-renderer pattern.** Activity rendering is centralized in `RENDERERS` so the activity page has no per-kind JSX branching. Keep that.
- **Keep token types narrow.** The current `topic` token shape is `{ type: 'topic'; href: string; title: string }`. If you need to carry an anchor, either include it in `href` (simplest) or extend the type — don't sprinkle anchor handling into renderers.
- **Don't change activity history.** No schema or back-fill work needed — `topic_id` is already on every row, `comment_id` is already in `meta` for comment events.
- **Verify with a real activity row.** After deploying, find a `topic_commented` activity entry on `slate.ljs.app/immediate-justice-aemxnvs/activity` and confirm the link goes straight to the comment.
