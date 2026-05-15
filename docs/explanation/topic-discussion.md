# Why comments live on topics, not slots

Slate has discussion threads, but they're not where you might expect — they're anchored on **topics**, not slots or shows or hosts. This page explains why, what shaped the data model, and where the system is intentionally limited.

## What the feature is for

The audience is the slate's members — typically 10 to 100 people coordinating what to record next. The conversation that happens before an episode airs ("should we cover this?", "what's the angle?", "I know someone who could speak to it") needs a home. That home is **the topic**.

It is not for public listener engagement. It is not Reddit. It is not YouTube comments. The volume is small, the audience is gated, the social pressure of a small group does the moderation work that a comments-on-the-public-internet product would need automated tooling for.

## Why anchor on topics

A topic outlives any one slot. Its discussion does too. Concretely:

1. A member posts a topic ("Industry deregulation post-2024 election")
2. Other members debate it in the topic's discussion: which guest, which framing, which date works
3. A host claims a slot, attaches the topic to it. The slot now points at the topic
4. The slot is recorded and published. The topic's status flips to `scheduled`
5. People keep talking — sometimes about the recording, sometimes about a planned re-airing, sometimes about a related episode

If comments were attached to **slots**, the discussion would fragment the moment the slot was assigned (and again if reassigned). If comments were attached to **shows** or **hosts**, the discussion would have no relationship to the actual conversation being had. **Topic** is the durable identity.

The slot detail page renders the **same** thread inline when `slot.topic_id` is set. Members talking about an upcoming episode see the conversation without clicking through to `/topics/[id]`. One thread, two surfaces.

## Why no `threads` table

The original proposal floated a polymorphic `threads(id, owner_type, owner_id)` table with `comments(thread_id, …)` underneath. We didn't build it. Reasons:

- **One commentable entity, today.** Topics. If "1 commentable entity" stays "1 commentable entity" for any non-trivial period, the thread row is pure ceremony — one more table, one more join, zero new capability.
- **Per-thread metadata is hypothetical.** Locked / pinned / last_activity_at — none of those exist as product features yet. If they do, they can live on the owning row (`topics.discussion_locked`) without inventing a new entity.
- **Polymorphic FKs have no DB-level integrity.** SQLite (and most engines) can't enforce `owner_id REFERENCES owner_type(id)`. The benefit of going polymorphic up front is mostly aesthetic.

The shape we shipped:

```sql
comments(id, slate_id, topic_id, parent_id, author_id, body, created_at, updated_at, deleted_at)
```

Flat `topic_id`. If we later want comments on slots or shows or hosts **independently of any topic**, we'll widen — drop `topic_id` for `(owner_type, owner_id)` in a migration, back-fill `owner_type='topic'` on existing rows, ship. The migration is cheap because the dataset is small.

## Why infinite nesting

The first cut considered a 2-level cap: top-level + one reply layer. We didn't ship that either.

The argument for capping was "Reddit-style endless threading is bad UX." That's true at Reddit scale. It's not true at slate scale. Ten-person threads at coordination scale routinely want "I'm replying specifically to Alice's point about timing, not to the parent topic." Capping at two levels forces members to either inline the context manually ("@alice: timing — what about…") or break the conversation across new top-level comments. Both are worse than letting the tree be a tree.

Recursion is bounded in practice by social factors — nobody nests 12 levels deep when there are 7 of you in the thread. So we let it grow naturally. The recursive `<Comment>` component renders itself via `Astro.self` until the tree runs out.

## What's intentionally absent

This was a v1 cut. Defer-list:

- **Email notifications on reply.** Useful, costs a queueing system + per-user subscription state we don't have yet.
- **@-mentions.** Useful in a coordination tool; requires a parser, name resolution, and links into the activity feed.
- **Reactions / emoji.** Mostly engagement-driven UX; adds counter columns and a join table.
- **Subscribe-to-thread.** Same plumbing as notifications.
- **Edit history per comment.** Topics already have a `topic_revisions` table because notes are wiki content where attribution and reversion matter. A comment's edit isn't worth the same audit weight; we just set `updated_at` and show "edited" inline.

The activity feed already gets a `topic_commented` event on every post (with `is_reply` flag), which means the unread badge in the nav surfaces new discussion without any new notification infrastructure. That's the v1 substitute for emails — good enough until volume changes the calculus.

## Permissions

| Action | Anon | Member | Slate admin | App Admin |
|---|---|---|---|---|
| Read | ✓ | ✓ | ✓ | ✓ |
| Post / reply | — | ✓ | ✓ | ✓ |
| Edit own | — | ✓ | ✓ | ✓ |
| Delete own | — | ✓ | ✓ | ✓ |
| Delete others (moderation) | — | — | ✓ | ✓ |

Read is public because the topic itself is public on a public slate. If the slate is private, the topic detail page returns 403 long before the thread renders — the comments don't need their own gate.

Author-only edit is a deliberate choice: a slate admin can **remove** a comment (it becomes "[deleted]" in the tree, replies intact), but they can't rewrite someone else's words. Editing other people's text into something they didn't say is the worst kind of moderation; deletion + visible-removal is honest.

## Deletion semantics

`deleted_at` is a soft-delete sentinel. The row stays in place, the body is hidden behind a `[deleted]` placeholder in the UI, and any replies underneath keep their context. This is the opposite of cascade-delete — we never want a reply to suddenly orphan because the parent comment was retracted.

Hard-delete is not exposed in the UI. If a real legal need arises (DMCA, GDPR erasure), it'd be a direct SQL operation, not a product affordance.

## Two indexes, two read patterns

There are two read shapes against `comments` and they want different indexes:

1. **"Show me the whole thread for this topic, in order"** — used by `fetchTopicComments()` when rendering a topic or slot detail page. Wants deleted rows IN so reply chains stay coherent (`[deleted]` placeholder + replies still rendered underneath). Served by `comments_topic_created (topic_id, created_at)`.

2. **"How many active comments does this topic have?"** — used by every list view (topic pool, dashboard topics, marquee top-20) to surface the activity signal. Wants deleted rows OUT. Served by `comments_topic_active (topic_id) WHERE deleted_at IS NULL`.

The partial index is the load-bearing trick. The aggregation query is:

```sql
SELECT topic_id, COUNT(*) FROM comments
WHERE deleted_at IS NULL
GROUP BY topic_id
```

A regular index on `(topic_id, deleted_at)` would still need to fetch each row to evaluate the predicate. A partial index whose definition matches the WHERE clause exactly lets SQLite do an index-only scan — the deleted rows aren't in the index at all. `EXPLAIN QUERY PLAN` shows `SCAN comments USING INDEX comments_topic_active` with no row visits.

This matters because the list views run the aggregation for every load: every viewer, every reload. The correlated-subquery version this replaced was K × O(log N + range scan) per page. The LEFT JOIN + GROUP BY version is one indexed pass over the active set, regardless of how many topics are in the list.
