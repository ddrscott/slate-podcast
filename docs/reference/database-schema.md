# Database schema

D1 (SQLite). Source of truth: [`schema.sql`](../../schema.sql). This page explains it.

`PRAGMA foreign_keys = ON` is set at the top of the file — referential integrity is enforced.

## `users`

Mirror of `auth.ljs.app`'s user records. Created on first sign-in via `ensureUserRow()`.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | The `auth.ljs.app` userId, stored verbatim |
| `email` | TEXT UNIQUE | Cached for fast lookup; updated on every sign-in |
| `headshot_url` | TEXT | Public R2 URL (via `/media/...`) |

## `slates`

One per podcast. Created by App-Admins.

| Column | Notes |
|---|---|
| `id` | `slt_<random>` |
| `slug` | URL component, **mutable** |
| `name`, `description` | Display metadata |
| `timezone` | IANA, drives slot expansion + UI rendering |
| `is_public` | 0/1; controls whether the public schedule page is visible to anonymous |
| `created_by` | FK → `users.id` |

## `slate_members`

Join table. A user has at most one role per slate.

| Column | Notes |
|---|---|
| `(slate_id, user_id)` | Composite PK |
| `role` | `'member'` or `'host'` |
| `joined_at` | Unix seconds |
| `promoted_at`, `promoted_by` | Set when a Member becomes a Host |

## `slot_rules`

Recurrence rules per slate. Multiple rules per slate are additive.

| Column | Notes |
|---|---|
| `cadence` | `'weekly'` or `'monthly'` |
| `days_of_week` | weekly: comma list `'mon,tue,wed,thu,fri'` |
| `nth_weekday` | monthly: `'1mon'` `'-1fri'` etc. |
| `time_of_day` | `'HH:MM'` in slate's timezone |
| `duration_minutes` | INTEGER |
| `start_date`, `end_date` | `'YYYY-MM-DD'`; `end_date` may be NULL |
| `active` | 0/1 |

See [scheduling-rules.md](scheduling-rules.md) for the full grammar.

## `slots`

The atomic unit of the schedule.

| Column | Notes |
|---|---|
| `id` | `slt_<random>` |
| `start_time` | **Unix seconds, UTC.** |
| `duration_minutes` | INTEGER |
| `status` | enum: `open` → `assigned` → `confirmed` → `recorded` → `published`, plus `cancelled` |
| `host_id` | FK → `users.id`. Set on claim. Any Host can overwrite. |
| `topic_id` | FK → `topics.id`. Set on schedule. |
| `custom_title` | If set, used instead of the topic's title |
| `notes_internal` | Host-only scratchpad |
| `show_notes` | Markdown |
| `show_notes_published_at` | NULL until publish |
| `promo_image_url` | Public R2 URL |
| `(slate_id, start_time)` | UNIQUE — guarantees regenerate-slots is idempotent |

### Status lifecycle

```
open ──claim──▶ assigned ──pick topic──▶ confirmed ──record──▶ recorded ──publish notes──▶ published
                    ▲                          │
                    │                       unschedule
                    └──────────────────────────┘
                                ↓
                            cancelled (admin)
```

## `slot_assets`

Attachments rendered alongside show notes.

| Column | Notes |
|---|---|
| `slot_id` | FK → `slots.id` |
| `kind` | `'audio' \| 'video' \| 'transcript' \| 'image' \| 'link'` |
| `url`, `title` | Display |
| `sort_order` | INTEGER, ascending |

## `topics`

Episode pitches. Posted by Members and Hosts.

| Column | Notes |
|---|---|
| `id` | `sug_<random>` |
| `author_id` | FK → `users.id` |
| `title`, `description`, `url`, `tags` | Display |
| `status` | `'open' \| 'scheduled' \| 'archived'` |
| `fingerprint` | Normalized title for dedupe (lowercase, alphanum-only, single-spaced) |
| `upvote_count` | Denormalized; kept in sync at write time |
| `scheduled_slot_id` | FK → `slots.id`. Set when a Host schedules it. |
| `scheduled_at`, `scheduled_by` | Audit |

## `topic_votes`

| `(topic_id, user_id)` PK | One vote per user per topic |

## `comments`

Discussion threads on topics. Member-on-member coordination, anchored on `topic_id`. Slot pages render the same thread inline when `slots.topic_id` matches — comments live in one place but surface on two pages.

| Column | Notes |
|---|---|
| `id` | `cmt_<random>` |
| `slate_id` | FK → `slates.id`, denormalized for fast per-slate queries |
| `topic_id` | FK → `topics.id` — the owning thread |
| `parent_id` | FK → `comments.id` (self) — nested reply; NULL for top-level comments. Infinite nesting. |
| `author_id` | FK → `users.id` |
| `body` | Markdown, ≤ 10 000 chars |
| `created_at`, `updated_at` | `updated_at` set on edit; NULL on initial write |
| `deleted_at` | Soft-delete sentinel — node is hidden but reply chain underneath is preserved |

**Indexes:**
- `comments_topic_created (topic_id, created_at)` — chronological tree fetch in `fetchTopicComments()`. Includes deleted rows since the UI renders them as `[deleted]` placeholders so reply chains keep context.
- `comments_slate (slate_id)`
- `comments_parent (parent_id)`
- `comments_topic_active (topic_id) WHERE deleted_at IS NULL` — partial index for the list-view comment-count aggregation (LEFT JOIN + GROUP BY). Matches `WHERE deleted_at IS NULL` exactly so SQLite does an index-only scan. Smaller than a full index (excludes deleted rows entirely).

Why flat `topic_id` instead of polymorphic `(owner_type, owner_id)`: only topics are commentable today. If we later widen to commenting on slots / shows / hosts independently of a topic, we'll switch then. See [`explanation/topic-discussion.md`](../explanation/topic-discussion.md).

## `activity`

Per-slate event stream. Append-only.

| Column | Notes |
|---|---|
| `kind` | See list below |
| `actor_id` | Who did it |
| `topic_id`, `slot_id`, `target_user_id` | Optional FKs to subjects |
| `meta` | JSON blob, free-form per kind |

**Kinds** (source of truth: `ActivityKind` in `src/lib/activity.ts`):

- Membership: `member_joined`, `host_promoted`, `host_demoted`, `slate_admin_granted`, `slate_admin_revoked`
- Hosts: `host_substituted`, `host_profile_edited`
- Topics: `topic_posted`, `topic_archived`, `topic_notes_edited`, `topic_commented`
- Slots: `slot_claimed`, `slot_scheduled`, `slot_unscheduled`, `notes_published`
- Shows: `show_created`, `show_renamed`, `show_wiki_edited`, `show_slots_assigned`
- Slate: `slate_renamed`

Writes are best-effort (a failed log doesn't block the underlying mutation).

## `activity_seen`

Per-user-per-slate read watermark. `activity.created_at <= watermark_at` ⇒ seen.

## `sent_reminders`

Reminder dedupe.

| `(slot_id, reminder_kind, recipient_user_id)` PK | `reminder_kind` is `'48h'` or `'24h'` |

`POST /api/cron/reminders` checks this table before sending; concurrent or repeat triggers within the same hour are no-ops.
