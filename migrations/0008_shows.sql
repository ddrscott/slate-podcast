-- 0008_shows.sql
--
-- Promotes "show" to a first-class entity, separating program identity
-- from the person hosting it.
--
-- Why: a host is a person; a show is a program. Today they're conflated
-- on slate_members (show_name, show_logo_url, profile_body) — meaning
-- "Jacob the host" and "Sin, Silence, Sentence the show" share one row.
-- That model breaks when a substitute host runs the show, or when a
-- host has multiple shows, or when the show's identity needs to evolve
-- independently of the person.
--
-- New shape:
--   shows           id, slate_id, host_id (default host), slug, name,
--                   cover_image_url, wiki_body, description, link,
--                   listen_* URLs
--   show_revisions  append-only history of wiki saves (same shape as
--                   topic_revisions / slate_member_revisions)
--   slots.show_id   each slot belongs to a show; slot.host_id remains
--                   "who's actually running this episode" (default
--                   matches show.host_id, but can differ for subs)
--
-- The existing slate_members.show_name / show_logo_url / profile_body
-- columns are NOT dropped here. The back-fill copies their values into
-- the new shows rows; code is migrated to read from shows; a later
-- migration drops the old columns once nothing reads them.
--
-- Data back-fill happens in scripts/backfill_shows.mjs after this
-- schema migration runs.
--
-- D1 quirk reminder: no BEGIN/COMMIT/PRAGMA in `wrangler d1 execute
-- --file`. Each statement is its own implicit transaction.
--
-- Apply remotely:
--   wrangler d1 execute slate-podcast --remote --file=./migrations/0008_shows.sql

CREATE TABLE IF NOT EXISTS shows (
  id                  TEXT PRIMARY KEY,
  slate_id            TEXT NOT NULL REFERENCES slates(id) ON DELETE CASCADE,
  host_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  slug                TEXT NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  cover_image_url     TEXT,
  wiki_body           TEXT,
  link                TEXT,
  listen_apple_url    TEXT,
  listen_spotify_url  TEXT,
  listen_youtube_url  TEXT,
  listen_rss_url      TEXT,
  created_at          INTEGER NOT NULL,
  UNIQUE (slate_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_shows_slate ON shows(slate_id);
CREATE INDEX IF NOT EXISTS idx_shows_host  ON shows(host_id);

CREATE TABLE IF NOT EXISTS show_revisions (
  id              TEXT PRIMARY KEY,
  show_id         TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  author_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  change_summary  TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_show_revisions_show
  ON show_revisions(show_id, created_at DESC);

ALTER TABLE slots ADD COLUMN show_id TEXT REFERENCES shows(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_slots_show ON slots(show_id);
