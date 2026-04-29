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

## `activity`

Per-slate event stream. Append-only.

| Column | Notes |
|---|---|
| `kind` | `member_joined`, `host_promoted`, `host_demoted`, `topic_posted`, `topic_archived`, `slot_scheduled`, `slot_unscheduled`, `notes_published`, `slate_renamed` |
| `actor_id` | Who did it |
| `topic_id`, `slot_id`, `target_user_id` | Optional FKs to subjects |
| `meta` | JSON blob, free-form per kind |

Writes are best-effort (a failed log doesn't block the underlying mutation).

## `activity_seen`

Per-user-per-slate read watermark. `activity.created_at <= watermark_at` ⇒ seen.

## `sent_reminders`

Reminder dedupe.

| `(slot_id, reminder_kind, recipient_user_id)` PK | `reminder_kind` is `'48h'` or `'24h'` |

`POST /api/cron/reminders` checks this table before sending; concurrent or repeat triggers within the same hour are no-ops.
