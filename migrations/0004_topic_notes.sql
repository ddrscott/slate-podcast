-- 0004_topic_notes.sql
--
-- Adds collaborative pre-show notes to topics. Members and hosts can edit;
-- every save creates a row in topic_revisions for attribution + history.
-- Last-write-wins on the topics.notes denormalized current body.
--
-- topics.notes        TEXT  — current notes body (markdown).
-- topic_revisions     row per save; full body + author + timestamp +
--                     optional change_summary.
--
-- D1 quirk reminder: no BEGIN/COMMIT/PRAGMA in `wrangler d1 execute --file`.
-- Each statement runs as its own implicit transaction.
--
-- Apply remotely:
--   wrangler d1 execute slate-podcast --remote --file=./migrations/0004_topic_notes.sql

ALTER TABLE topics ADD COLUMN notes TEXT;

CREATE TABLE IF NOT EXISTS topic_revisions (
  id              TEXT PRIMARY KEY,
  topic_id        TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  author_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  change_summary  TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topic_revisions_topic ON topic_revisions(topic_id, created_at DESC);
