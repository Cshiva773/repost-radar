-- 006_source_removal: the crawler re-checks posts behind open candidates. When a copy is taken down
-- (by its author, the platform, or after a notice), open candidates close as `removed`.
ALTER TYPE candidate_status ADD VALUE IF NOT EXISTS 'removed';

ALTER TABLE crawled_posts ADD COLUMN source_checked_at TIMESTAMPTZ;
ALTER TABLE crawled_posts ADD COLUMN source_removed_at TIMESTAMPTZ;
