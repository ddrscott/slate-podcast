-- 0011_slot_episode_number.sql
--
-- Per-show episode numbering on slots.
--
-- Why on slots, not a separate episodes table: a published slot is
-- already an episode in this schema — it carries title, body, artwork,
-- media (via slot_assets), publish timestamp, host, and show. Splitting
-- into episodes + slots would duplicate every one of those fields and
-- create two surfaces displaying the same content. If we ever need
-- multi-slot episodes or episodes that exist independently of any
-- calendar slot, that's the moment to introduce a new table — until
-- then, slots ARE episodes.
--
-- Null by default: a slot only gets a number when it's published or
-- back-filled. Scheduled-but-unrecorded slots stay null; cancelled
-- slots stay null. Gaps in the per-show sequence are intentional
-- (skipped, never-aired, out-of-order recording) — the partial unique
-- index just prevents duplicates.
--
-- Apply remotely:
--   wrangler d1 execute slate-podcast --remote --file=./migrations/0011_slot_episode_number.sql

ALTER TABLE slots ADD COLUMN episode_number INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS slots_show_episode
  ON slots(show_id, episode_number)
  WHERE episode_number IS NOT NULL;
