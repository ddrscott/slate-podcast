-- 0003_marquee_artwork.sql
--
-- Additive: per-slate marquee identity. Square show artwork (centerpiece),
-- auto-extracted accent color, and four distribution-channel URLs render
-- on the public landing page. cover_image_url stays as the optional
-- landscape banner. All columns nullable; null = today's marquee, byte-
-- for-byte.
--
-- D1 quirk reminder: no BEGIN/COMMIT/PRAGMA in `wrangler d1 execute --file`.
-- Each ADD COLUMN is its own implicit transaction.
--
-- Apply remotely:
--   wrangler d1 execute slate-podcast --remote --file=./migrations/0003_marquee_artwork.sql

ALTER TABLE slates ADD COLUMN artwork_image_url   TEXT;
ALTER TABLE slates ADD COLUMN marquee_accent      TEXT;
ALTER TABLE slates ADD COLUMN listen_apple_url    TEXT;
ALTER TABLE slates ADD COLUMN listen_spotify_url  TEXT;
ALTER TABLE slates ADD COLUMN listen_youtube_url  TEXT;
ALTER TABLE slates ADD COLUMN listen_rss_url      TEXT;
