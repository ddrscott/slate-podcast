-- Slate v2 — Hosts, Members, Topics, Upvotes (D1 / SQLite)
-- Apply: `npm run db:apply:local` or `npm run db:apply:remote`

PRAGMA foreign_keys = ON;

-- ─── Identity ──────────────────────────────────────────────────────────────
-- Delegated to auth.ljs.app. `id` is the userId issued by auth.ljs.app,
-- stored as-is on first sign-in. `email` is cached for fast lookup.
-- `display_name` is what we render wherever a person appears in the UI;
-- when null, the helper falls back to the local part of `email`.
-- `headshot_url` is the public URL of the user's uploaded profile image (R2).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  headshot_url TEXT
);

-- ─── Slate ─────────────────────────────────────────────────────────────────
-- Top-level. Created by App Admins (anyone with the auth.ljs.app `admin` or
-- `slate:admin` JWT scope). Slug is globally unique and mutable — change it
-- to a hard-to-guess string for soft privacy.
CREATE TABLE IF NOT EXISTS slates (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  is_public INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slates_slug ON slates(slug);

-- ─── Slate membership ──────────────────────────────────────────────────────
-- Open signup as 'member' via /[slate]/join. Promotion to 'host' is
-- App-Admin only. A user has at most one role per slate (host > member).
CREATE TABLE IF NOT EXISTS slate_members (
  slate_id TEXT NOT NULL REFERENCES slates(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('member','host')),
  joined_at INTEGER NOT NULL,
  promoted_at INTEGER,
  promoted_by TEXT REFERENCES users(id),
  PRIMARY KEY (slate_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_slate_members_user ON slate_members(user_id);
CREATE INDEX IF NOT EXISTS idx_slate_members_slate_role ON slate_members(slate_id, role);

-- ─── Recurrence rules ──────────────────────────────────────────────────────
-- Hosts (or App Admins) configure these per slate. Slot generation
-- combines all active rules and is idempotent via UNIQUE(slate_id, start_time).
CREATE TABLE IF NOT EXISTS slot_rules (
  id TEXT PRIMARY KEY,
  slate_id TEXT NOT NULL REFERENCES slates(id) ON DELETE CASCADE,
  name TEXT,
  cadence TEXT NOT NULL CHECK (cadence IN ('weekly','monthly')),
  days_of_week TEXT,
  nth_weekday TEXT,
  time_of_day TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slot_rules_slate ON slot_rules(slate_id, active);

-- ─── Slots ────────────────────────────────────────────────────────────────
-- Status lifecycle:
--   open      → no host yet
--   assigned  → host_id set, no topic yet
--   confirmed → host_id + topic_id both set
--   recorded  → host marked recorded
--   published → show notes published
--   cancelled → coordinator killed it
-- Hosts can sub in for each other (overwrite host_id) — cooperative coverage.
CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  slate_id TEXT NOT NULL REFERENCES slates(id) ON DELETE CASCADE,
  rule_id TEXT REFERENCES slot_rules(id) ON DELETE SET NULL,
  start_time INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','assigned','confirmed','recorded','published','cancelled')),
  host_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  custom_title TEXT,
  notes_internal TEXT,
  show_notes TEXT,
  show_notes_published_at INTEGER,
  promo_image_url TEXT,            -- public R2 URL of the slot's social-share image
  created_at INTEGER NOT NULL,
  UNIQUE (slate_id, start_time)
);
CREATE INDEX IF NOT EXISTS idx_slots_slate_time ON slots(slate_id, start_time);
CREATE INDEX IF NOT EXISTS idx_slots_status ON slots(slate_id, status);
CREATE INDEX IF NOT EXISTS idx_slots_host ON slots(host_id);

CREATE TABLE IF NOT EXISTS slot_assets (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('audio','video','transcript','image','link')),
  url TEXT NOT NULL,
  title TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slot_assets_slot ON slot_assets(slot_id);

-- ─── Topics ───────────────────────────────────────────────────────────────
-- Members and Hosts post topics; both can upvote.
-- `fingerprint` is a normalized title for duplicate detection.
-- `upvote_count` is denormalized — kept in sync at write time.
-- `status` flips to 'scheduled' when a host marries it to a slot.
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  slate_id TEXT NOT NULL REFERENCES slates(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT,
  tags TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','scheduled','archived')),
  fingerprint TEXT NOT NULL,
  upvote_count INTEGER NOT NULL DEFAULT 0,
  scheduled_slot_id TEXT REFERENCES slots(id) ON DELETE SET NULL,
  scheduled_at INTEGER,
  scheduled_by TEXT REFERENCES users(id),
  submitted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topics_slate_status ON topics(slate_id, status);
CREATE INDEX IF NOT EXISTS idx_topics_slate_fp ON topics(slate_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_topics_votes ON topics(slate_id, upvote_count DESC);

CREATE TABLE IF NOT EXISTS topic_votes (
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voted_at INTEGER NOT NULL,
  PRIMARY KEY (topic_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_topic_votes_user ON topic_votes(user_id);

-- ─── Activity log ──────────────────────────────────────────────────────────
-- Per-slate event stream. New events appended on the relevant mutation
-- endpoints (member join, host promotion, topic posted, slot
-- scheduled/unscheduled, show notes published). Read state is tracked
-- per-user-per-slate as a high-water mark — `created_at <= watermark_at`
-- means the user has seen it.
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  slate_id TEXT NOT NULL REFERENCES slates(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  slot_id TEXT REFERENCES slots(id) ON DELETE SET NULL,
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  meta TEXT,                                                    -- JSON; free-form per-kind payload
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_slate_time ON activity(slate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS activity_seen (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slate_id TEXT NOT NULL REFERENCES slates(id) ON DELETE CASCADE,
  watermark_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, slate_id)
);

-- ─── Reminder dedupe (cron worker) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sent_reminders (
  slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  reminder_kind TEXT NOT NULL CHECK (reminder_kind IN ('48h','24h')),
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (slot_id, reminder_kind, recipient_user_id)
);
