-- 0006_host_wiki.sql
--
-- Long-form host profile page per slate — a markdown wiki body for
-- everything that doesn't fit on a short bio: platform links, donation
-- buttons, org affiliations, intro video embed, what-the-show-is-about,
-- recurring segments. The wiki replaces the impulse to add N social-link
-- columns; hosts express themselves in markdown.
--
--   slate_members.profile_body  TEXT  — denormalized current body
--   slate_member_revisions             append-only history:
--                                       id, slate_id, user_id, body,
--                                       author_id, change_summary, created_at
--
-- Last-write-wins on the denormalized body; the revisions table is the
-- source of truth for attribution + recovery. Same shape as topics.notes
-- + topic_revisions (migration 0004).
--
-- D1 quirk reminder: no BEGIN/COMMIT/PRAGMA in `wrangler d1 execute
-- --file`. Each statement is its own implicit transaction.
--
-- Apply remotely:
--   wrangler d1 execute slate-podcast --remote --file=./migrations/0006_host_wiki.sql

ALTER TABLE slate_members ADD COLUMN profile_body TEXT;

CREATE TABLE IF NOT EXISTS slate_member_revisions (
  id              TEXT PRIMARY KEY,
  slate_id        TEXT NOT NULL REFERENCES slates(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  author_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  change_summary  TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slate_member_revisions_target
  ON slate_member_revisions(slate_id, user_id, created_at DESC);
