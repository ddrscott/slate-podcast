-- 0009_topic_comments.sql
--
-- Discussion threads on topics. Member-on-member coordination — small
-- volume, gated to slate members. Slot detail pages render the same
-- thread inline (via the slot's topic_id) so a discussion that begins
-- pre-record carries through after a slot is assigned to that topic.
--
-- Why a flat owner column (topic_id) vs. polymorphic (owner_type +
-- owner_id): only topics are commentable today. If we later want
-- comments directly on slots / shows / hosts independently of any
-- topic, we'll widen to polymorphic then. Saves a join + a column for
-- now.
--
-- D1 quirk reminder: no BEGIN/COMMIT/PRAGMA in `wrangler d1 execute
-- --file`. Each statement is its own implicit transaction.
--
-- Apply remotely:
--   wrangler d1 execute slate-podcast --remote --file=./migrations/0009_topic_comments.sql

CREATE TABLE IF NOT EXISTS comments (
  id           TEXT PRIMARY KEY,
  slate_id     TEXT NOT NULL REFERENCES slates(id) ON DELETE CASCADE,
  topic_id     TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  parent_id    TEXT REFERENCES comments(id) ON DELETE CASCADE,
  author_id    TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER,
  deleted_at   INTEGER
);

CREATE INDEX IF NOT EXISTS comments_topic_created ON comments(topic_id, created_at);
CREATE INDEX IF NOT EXISTS comments_slate         ON comments(slate_id);
CREATE INDEX IF NOT EXISTS comments_parent        ON comments(parent_id);
