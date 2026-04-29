# Why a shared suggestion pool

Most calendar tools tie a topic 1:1 with a calendar event: you book a slot, you fill in what it's about, done.

Slate splits those into two tables (`slots` and `suggestions`) connected by a nullable foreign key. The suggestion exists *before* it has a slot, and the slot exists *before* it has a suggestion.

This is the central design decision in the data model. The reasons:

## Topics outlive moments

The good idea ("we should do an episode on X") shows up at a different time than the open slot. Forcing them to be created together loses ideas — people don't post a topic when there's no available slot, and they don't claim a slot when they don't have a topic ready.

By making them independent rows:

- **Members** (who don't have slot-claiming rights) can still contribute the most valuable thing — topic ideas — without needing to also know the schedule.
- **Speakers** browse the pool when they're ready to commit to a slot. They're not under pressure to invent a topic at slot-claim time.

## Upvotes turn the pool into a backlog

Once topics are first-class, voting is trivial (`suggestion_votes` table). The denormalized `upvote_count` keeps "top of the pool" cheap to render. Speakers see what the audience wants discussed and pick from the top.

This wouldn't work in a coupled model — you can't upvote a thing that doesn't exist independently of a calendar event.

## Custom titles handle the long tail

Some episodes are spontaneous, planned in private, or otherwise don't go through the pool. The `slots.custom_title` column covers this: a Speaker can claim a slot, set a custom title, and skip the suggestion linkage. The model is still clean — `suggestion_id` is just NULL.

## Fingerprint dedupe

`suggestions.fingerprint` is a normalized form of the title (lowercase, alphanum-only, single-spaced). The submission UI checks `/api/slates/[id]/suggestions/check?title=...` before submit; if there's a fingerprint match, we nudge the user to upvote the existing suggestion instead of creating a near-duplicate.

This is what keeps the pool useful at scale. Without it, "AI ethics", "AI Ethics", and "AI Ethics?" would all be separate items splitting votes.

## Status flow

```
suggestion: open ──Speaker schedules──▶ scheduled ──── (slot completed) ────▶ archived (manual)
                ▲                            │
                │                       unschedule
                └────────────────────────────┘
```

A `scheduled` suggestion has a `scheduled_slot_id` pointing at the slot. Unscheduling clears it and bumps the suggestion back to `open` for re-use.

## What we didn't do

- **No tagging or categorization in v1.** A free-form `tags` TEXT column exists but no UI consumes it. Premature.
- **No threaded discussion on suggestions.** Explicitly out of scope — Slate is a scheduler, not a forum. Use the description field; if you want a debate, take it to chat.
- **No "expire after N days" on suggestions.** They sit in the pool until someone schedules or archives them. The friction for an outdated topic is low (it just doesn't get picked); the cost of automatic deletion (losing useful ideas, making the pool feel ephemeral) is high.
