# Claim a slot and pick a topic

You're a Host. There are open slots on the schedule. You want to put your name and a topic on one.

## The fast path: claim & schedule from the slot page

1. Open the slate's main schedule (`/<slug>`).
2. Click an open slot.
3. **Claim & schedule** opens a panel with the topic pool, sorted by upvote count.
4. Pick a topic. Click **Confirm**.

The slot flips to `confirmed`. You're the Host. The topic's status flips to `scheduled` and points back at this slot.

## Claiming without a topic yet

If you know you want the slot but haven't picked the topic:

1. Open the slot, click **Claim** (without picking a topic).
2. The slot is `assigned`.

You can pick a topic later from the same slot page.

## Custom topic (not from the pool)

On the slot page, instead of picking from the topic pool, fill in **Custom title**. The slot becomes `confirmed` with `custom_title` set and `topic_id` null.

## Unscheduling

On the slot page, **Unschedule**:

- Removes the topic link (if any).
- Reverts the slot to `assigned` (you're still the host) or `open` (if you also clear yourself).
- Bumps the topic back to `open` so it's available again.

## After recording

On the slot page, **Mark recorded**. The slot status becomes `recorded`. This unlocks the show notes editor's **Publish** button.

(You can edit notes anytime — `recorded` just signals "the audio exists".)

## Publishing show notes

See **[How-to: write and publish show notes](publish-show-notes.md)**.
