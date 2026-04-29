-- 0002_host_profile_fields.sql
--
-- Additive: Host profile fields (bio, tagline, link) on users +
-- cover image on slates. All TEXT columns, all nullable, all default null.
-- These feed the marquee landing page (PR 3).
--
-- D1 quirk reminder: no BEGIN/COMMIT/PRAGMA in `wrangler d1 execute --file`.
-- Each ADD COLUMN is its own implicit transaction. They're independent and
-- idempotent-safe to retry one at a time if a step fails.
--
-- Apply remotely:
--   wrangler d1 execute slate-podcast --remote --file=./migrations/0002_host_profile_fields.sql

ALTER TABLE users  ADD COLUMN bio              TEXT;
ALTER TABLE users  ADD COLUMN tagline          TEXT;
ALTER TABLE users  ADD COLUMN link             TEXT;

ALTER TABLE slates ADD COLUMN cover_image_url  TEXT;
