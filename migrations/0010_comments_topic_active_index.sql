-- 0010_comments_topic_active_index.sql
--
-- Partial index for the comment-count aggregation used on the topic
-- list views (/topics, /edit dashboard, marquee top-20). The list
-- queries do:
--
--   LEFT JOIN (
--     SELECT topic_id, COUNT(*) AS n
--     FROM comments
--     WHERE deleted_at IS NULL
--     GROUP BY topic_id
--   ) cc ON cc.topic_id = topics.id
--
-- A partial index on (topic_id) filtered to active rows lets SQLite
-- satisfy that GROUP BY with an index-only scan — no row visits, no
-- post-fetch filter on deleted_at. Smaller too (excludes soft-deleted
-- rows from the index entirely).
--
-- The existing comments_topic_created index stays — it's still right
-- for the chronological-tree fetch in fetchTopicComments(), which
-- DOES want deleted rows (renders as "[deleted]" placeholders so reply
-- chains keep their context).
--
-- Apply remotely:
--   wrangler d1 execute slate-podcast --remote --file=./migrations/0010_comments_topic_active_index.sql

CREATE INDEX IF NOT EXISTS comments_topic_active
  ON comments(topic_id)
  WHERE deleted_at IS NULL;
