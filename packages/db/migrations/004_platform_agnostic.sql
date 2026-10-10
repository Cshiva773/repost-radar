-- 004_platform_agnostic: platforms are validated by the @repost-radar/platforms registry, not a
-- Postgres enum, so adding a platform needs no migration. Reddit-specific column names become generic.

ALTER TABLE watch_targets ALTER COLUMN platform DROP DEFAULT;
ALTER TABLE watch_targets ALTER COLUMN platform TYPE TEXT USING platform::text;
ALTER TABLE watch_targets ALTER COLUMN platform SET DEFAULT 'reddit';

ALTER TABLE crawled_posts ALTER COLUMN platform DROP DEFAULT;
ALTER TABLE crawled_posts ALTER COLUMN platform TYPE TEXT USING platform::text;

ALTER TABLE notice_templates ALTER COLUMN platform TYPE TEXT USING platform::text;

DROP TYPE platform_kind;

-- "subreddit" -> the platform's target (subreddit, hashtag, account...). The live-unique index
-- on lower(subreddit) follows the rename automatically.
ALTER TABLE watch_targets RENAME COLUMN subreddit TO target_name;

-- The post a crawled image came from (Reddit fullname, Bluesky at:// URI, ...)
ALTER TABLE crawled_posts RENAME COLUMN reddit_post_id TO source_post_id;
ALTER INDEX crawled_posts_reddit_post_idx RENAME TO crawled_posts_source_post_idx;
