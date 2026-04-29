# API endpoints

All endpoints are Astro endpoints under `src/pages/api/`. They return JSON unless otherwise noted, in the shape `{ ok: true, ... }` or `{ ok: false, error: 'code' }`.

Authentication: most endpoints require a session cookie (set by `/api/auth/callback`). The cron endpoint requires a bearer token instead.

| Code | Meaning |
|---|---|
| `unauthorized` | No session cookie / invalid |
| `app_admin_required` | Session valid but missing `admin` / `slate:admin` scope |
| `host_required` | Not a Host on the slate |
| `membership_required` | Not a Member or Host on the slate |
| `internal` | Unhandled server error (logged) |

## Auth

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/auth/callback?next=...&token=...` | Receives JWT from auth.ljs.app, sets cookie, 302 to `next` |
| `POST` | `/api/auth/sign-out` | Clears the session cookie |

## Me

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/me/headshot` | Multipart upload — replaces the current user's headshot in R2 |

## Slates (App-Admin)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/slates` | Create a new slate |
| `PATCH` | `/api/slates/[id]` | Update slate (name / slug / timezone / visibility) |

## Per-slate (Member or Host)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/slates/[id]/join` | Self-join as Member |
| `GET` | `/api/slates/[id]/open-slots` | JSON list of open slots in the slate |
| `GET` | `/api/slates/[id]/hosts` | List Hosts |
| `POST` | `/api/slates/[id]/topics` | Post a new topic |
| `GET` | `/api/slates/[id]/topics/check?title=...` | Fingerprint dedupe check |
| `POST` | `/api/slates/[id]/activity/mark-read` | Update the user's activity watermark |

## Per-slate admin (Host or App-Admin)

| Method | Path | Purpose |
|---|---|---|
| `GET / POST / PATCH / DELETE` | `/api/slates/[id]/admin/rules` | Recurrence-rule CRUD |
| `GET / POST` | `/api/slates/[id]/admin/slots` | Slot listing + manual create |
| `POST` | `/api/slates/[id]/admin/regenerate-slots` | Expand all active rules and insert new slots |
| `POST` | `/api/slates/[id]/admin/bulk-edit` | Bulk patch from the AG Grid sheet |
| `GET` | `/api/slates/[id]/admin/export.csv` | CSV of all slots |
| `POST / DELETE` | `/api/slates/[id]/hosts/[user_id]` | Promote / demote |

## Cross-slate admin (App-Admin)

| Method | Path | Purpose |
|---|---|---|
| `PATCH / DELETE` | `/api/admin/rules/[id]` | Edit / delete a single rule |
| `PATCH / DELETE` | `/api/admin/slots/[id]` | Edit / delete a single slot |
| `POST` | `/api/admin/slots/[id]/[action]` | Status transitions (`cancel`, `reopen`, etc.) |
| `PATCH / DELETE` | `/api/admin/topics/[id]` | Edit / archive a topic |

## Slot actions (Host on slate, or App-Admin)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/slots/[id]/claim-and-schedule` | One-shot claim + topic assignment |
| `POST` | `/api/slots/[id]/assign-host` | Set `host_id` |
| `PATCH` | `/api/slots/[id]/topic` | Set / clear `topic_id` or `custom_title` |
| `PATCH` | `/api/slots/[id]/show-notes` | Save / publish / unpublish notes |
| `POST / DELETE` | `/api/slots/[id]/assets` | Add a slot asset |
| `POST` | `/api/slots/[id]/promo-image` | Upload promo image (R2) |
| `PATCH / DELETE` | `/api/slot-assets/[id]` | Edit / delete a single asset |

## Topics

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/topics/[id]/vote` | Toggle the user's upvote |

## Cron

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/cron/reminders` | `Authorization: Bearer $CRON_SECRET` | Send 48h/24h reminders, dedupe via `sent_reminders`. Idempotent within the hour. |

Returns `{ ok: true, sent: N, skipped: M }`.
