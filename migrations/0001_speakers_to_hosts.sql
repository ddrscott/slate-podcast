-- 0001_speakers_to_hosts.sql
--
-- One-shot rename: speakers → hosts, suggestions → topics.
--
-- Strategy:
--   * In-place ALTER TABLE / RENAME COLUMN where SQLite supports it (D1 ≥ 3.42).
--     Indexes and foreign keys are auto-rewritten by SQLite.
--   * Recreate slate_members because CHECK constraints can't be altered in place
--     (the old CHECK allowed role IN ('member','speaker'); the new one allows
--     IN ('member','host')).
--   * Rewrite activity.kind enum values + meta JSON keys with literal UPDATEs.
--
-- Apply locally (dry run first):
--   wrangler d1 execute slate-podcast --local --file=./migrations/0001_speakers_to_hosts.sql
-- Apply remotely (after local verify and a fresh D1 backup/bookmark):
--   wrangler d1 execute slate-podcast --remote --file=./migrations/0001_speakers_to_hosts.sql
--
-- NOT idempotent. Run exactly once per environment.
--
-- D1 does NOT accept BEGIN TRANSACTION / COMMIT or PRAGMA inside
-- `wrangler d1 execute --file` (it routes through Durable Objects which have
-- their own transaction API). Each statement runs as its own implicit
-- transaction. If a step fails, restore from the D1 bookmark you took before
-- running this. slate_members has no inbound foreign keys so its
-- drop+recreate is safe without disabling foreign_keys.

-- ─── Tables ─────────────────────────────────────────────────────────────────
ALTER TABLE suggestions      RENAME TO topics;
ALTER TABLE suggestion_votes RENAME TO topic_votes;

-- ─── Columns ────────────────────────────────────────────────────────────────
ALTER TABLE topic_votes RENAME COLUMN suggestion_id TO topic_id;
ALTER TABLE slots       RENAME COLUMN suggestion_id TO topic_id;
ALTER TABLE slots       RENAME COLUMN speaker_id    TO host_id;
ALTER TABLE activity    RENAME COLUMN suggestion_id TO topic_id;

-- ─── Indexes (rename for clarity; refs already auto-updated by RENAME) ──────
DROP INDEX IF EXISTS idx_suggestions_slate_status;
DROP INDEX IF EXISTS idx_suggestions_slate_fp;
DROP INDEX IF EXISTS idx_suggestions_votes;
DROP INDEX IF EXISTS idx_votes_user;
DROP INDEX IF EXISTS idx_slots_speaker;
CREATE INDEX idx_topics_slate_status ON topics(slate_id, status);
CREATE INDEX idx_topics_slate_fp     ON topics(slate_id, fingerprint);
CREATE INDEX idx_topics_votes        ON topics(slate_id, upvote_count DESC);
CREATE INDEX idx_topic_votes_user    ON topic_votes(user_id);
CREATE INDEX idx_slots_host          ON slots(host_id);

-- ─── slate_members: recreate to swap CHECK constraint + map data ────────────
CREATE TABLE slate_members_new (
  slate_id    TEXT NOT NULL REFERENCES slates(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('member','host')),
  joined_at   INTEGER NOT NULL,
  promoted_at INTEGER,
  promoted_by TEXT REFERENCES users(id),
  PRIMARY KEY (slate_id, user_id)
);
INSERT INTO slate_members_new (slate_id, user_id, role, joined_at, promoted_at, promoted_by)
SELECT slate_id, user_id,
       CASE role WHEN 'speaker' THEN 'host' ELSE role END,
       joined_at, promoted_at, promoted_by
FROM slate_members;
DROP TABLE slate_members;
ALTER TABLE slate_members_new RENAME TO slate_members;
CREATE INDEX idx_slate_members_user        ON slate_members(user_id);
CREATE INDEX idx_slate_members_slate_role  ON slate_members(slate_id, role);

-- ─── Activity log: rewrite event kinds + meta JSON keys ─────────────────────
UPDATE activity SET kind = 'host_promoted'    WHERE kind = 'speaker_promoted';
UPDATE activity SET kind = 'host_demoted'     WHERE kind = 'speaker_demoted';
UPDATE activity SET kind = 'host_substituted' WHERE kind = 'speaker_substituted';
UPDATE activity SET kind = 'topic_posted'     WHERE kind = 'suggestion_posted';
UPDATE activity SET kind = 'topic_archived'   WHERE kind = 'suggestion_archived';
UPDATE activity
   SET meta = REPLACE(REPLACE(meta,
              '"new_speaker_id"',         '"new_host_id"'),
              '"replaced_suggestion_id"', '"replaced_topic_id"')
 WHERE meta IS NOT NULL;
