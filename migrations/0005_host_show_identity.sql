-- 0005_host_show_identity.sql
--
-- Additive: per-host-per-slate show identity. A host now has a
-- distinct "show" name and logo separate from their personal display
-- name and headshot. Both nullable; null = fall back to the personal
-- profile + slate artwork.
--
--   slate_members.show_name      TEXT  — e.g. "The Justice Hour"
--   slate_members.show_logo_url  TEXT  — square (1:1) R2 URL
--
-- Render precedence on the marquee (see SlateMarquee.astro):
--   tile art: slots.promo_image_url > slate_members.show_logo_url
--             > slates.artwork_image_url > host headshot
--   byline:   slate_members.show_name (no "with" prefix)
--             > "with " + host display_name
--
-- D1 quirk reminder: no BEGIN/COMMIT/PRAGMA in `wrangler d1 execute
-- --file`. Each ADD COLUMN runs as its own implicit transaction.
--
-- Apply remotely:
--   wrangler d1 execute slate-podcast --remote --file=./migrations/0005_host_show_identity.sql

ALTER TABLE slate_members ADD COLUMN show_name      TEXT;
ALTER TABLE slate_members ADD COLUMN show_logo_url  TEXT;
