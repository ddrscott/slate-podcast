# Scheduling rules

A `slot_rules` row describes a recurrence. The recurrence engine in `src/lib/recurrence.ts` expands rules into concrete UTC slot timestamps, respecting the slate's timezone (DST-correct via `Intl.DateTimeFormat`).

## Fields

| Field | Required | Format | Notes |
|---|---|---|---|
| `name` | no | TEXT | Display only |
| `cadence` | yes | `'weekly'` or `'monthly'` | Drives which fields below apply |
| `days_of_week` | weekly only | comma list of `mon,tue,wed,thu,fri,sat,sun` | One slot per matching day per week |
| `nth_weekday` | monthly only | `<n><weekday>` | `n` is `1`–`5` or `-1` (last). E.g. `1mon`, `3fri`, `-1thu` |
| `time_of_day` | yes | `'HH:MM'` 24-hour | Resolved in the slate's timezone |
| `duration_minutes` | yes | INTEGER | Stored on each generated slot |
| `start_date` | yes | `'YYYY-MM-DD'` | Inclusive |
| `end_date` | no | `'YYYY-MM-DD'` | Inclusive. NULL ⇒ runs forever |
| `active` | yes | 0/1 | Inactive rules are skipped during regenerate |

## Examples

```sql
-- Weekly Monday + Wednesday at 18:00, 60 min
INSERT INTO slot_rules (..., cadence, days_of_week, time_of_day, duration_minutes, start_date)
VALUES (..., 'weekly', 'mon,wed', '18:00', 60, '2026-01-01');

-- First Tuesday of every month at 19:30, 90 min, ends Dec 31
INSERT INTO slot_rules (..., cadence, nth_weekday, time_of_day, duration_minutes, start_date, end_date)
VALUES (..., 'monthly', '1tue', '19:30', 90, '2026-01-01', '2026-12-31');

-- Last Friday of every month at 09:00, 30 min
INSERT INTO slot_rules (..., cadence, nth_weekday, time_of_day, duration_minutes, start_date)
VALUES (..., 'monthly', '-1fri', '09:00', 30, '2026-01-01');
```

## Generation behavior

`POST /api/slates/[id]/admin/regenerate-slots` (or **Regenerate** button) does:

1. Loads all active rules for the slate.
2. For each, calls `expandRule(rule, slate.timezone, horizon)` → `ExpandedSlot[]`.
3. `INSERT OR IGNORE INTO slots (slate_id, start_time, ...)` — `UNIQUE(slate_id, start_time)` makes this idempotent.
4. Existing slots (any status) are untouched. The engine never overwrites status, host, or notes.

Default horizon: 1 year from now. Configurable per call.

## DST handling

Rules express times in the slate's timezone. The engine converts each occurrence through `Intl.DateTimeFormat` so a 09:00 CT slot is 14:00 UTC in summer, 15:00 UTC in winter — the displayed local time stays 09:00.

## Removing slots that no longer match

Editing a rule doesn't delete previously-generated slots. To clean up:

- Cancel them in the AG Grid admin slot view, or
- `DELETE FROM slots WHERE slate_id = ? AND status = 'open' AND rule_id = ?` and regenerate.

## Limits

The schema has no built-in cadences for "bi-weekly", "every 3 days", or arbitrary intervals. Workarounds:

- Bi-weekly Monday → weekly Monday rule + manual cancellation of off-week slots.
- Custom cadences → write multiple rules with different `start_date`s and short windows, or hand-INSERT slots.
