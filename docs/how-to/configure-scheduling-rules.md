# Configure scheduling rules

Slate generates slots from **rules**, not by hand. Rules describe a cadence; Slate expands them into concrete UTC slot timestamps. You can have multiple rules per slate; they overlay.

This guide covers the common shapes. For the full field grammar, see [Reference: scheduling rules](../reference/scheduling-rules.md).

## Where

```
https://slate.ljs.app/<slug>/admin/rules
```

You need to be a Host on the slate (or App-Admin).

## Recipe: weekly on weekdays

A daily-ish show recording every weekday at 6pm in the slate's timezone.

| Field | Value |
|---|---|
| Cadence | weekly |
| Days of week | mon,tue,wed,thu,fri |
| Time of day | 18:00 |
| Duration | 60 minutes |
| Start date | today |
| End date | (blank — runs forever) |

## Recipe: bi-weekly on Mondays

The schema doesn't have a "bi-weekly" cadence. Use two staggered weekly rules with `end_date` cutoffs, or do every-week and `cancel` the off-week slots after generation.

The simpler workaround: a weekly Monday rule, then bulk-cancel alternating weeks via the admin slot grid.

## Recipe: first Tuesday of the month

| Field | Value |
|---|---|
| Cadence | monthly |
| Nth weekday | 1tue |
| Time of day | 19:30 |
| Duration | 90 minutes |

`nth_weekday` format: `<n><weekday>`, where `n` is `1`–`5` or `-1` (last). Examples: `1mon`, `3fri`, `-1thu`.

## Recipe: last Friday of every month

| Field | Value |
|---|---|
| Cadence | monthly |
| Nth weekday | -1fri |

## After editing rules — regenerate

Rules don't auto-generate. Hit **Regenerate slots** (button on the rules page). This:

1. Expands all active rules through the configured horizon (default 1 year).
2. Inserts new slots that don't already exist (deduped by `UNIQUE(slate_id, start_time)`).
3. Leaves existing slots alone — never overwrites status, host, or notes.

To remove slots that no longer match a rule, cancel them in the admin slot grid.

## Deactivating a rule

Toggle **active** off. Existing slots stay; no new ones generate.

## Editing the slate timezone

Editing `slates.timezone` doesn't shift existing slot timestamps (those are stored as UTC integers). It only affects how *future* expansions and the UI render times. If you need to shift existing slots, cancel them and regenerate.
