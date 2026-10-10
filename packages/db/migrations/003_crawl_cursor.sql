-- 003_crawl_cursor: the crawler stops paging once it reaches a post it has already seen.
-- Comparing timestamps as well as ids keeps that working when the last-seen post is deleted.
ALTER TABLE watch_targets ADD COLUMN last_seen_posted_at TIMESTAMPTZ;
ALTER TABLE watch_targets ADD COLUMN posts_seen_count BIGINT NOT NULL DEFAULT 0;

-- Gallery posts hold several images; each gets its own row keyed "<postId>:<mediaId>".
ALTER TABLE crawled_posts ADD COLUMN reddit_post_id TEXT;
CREATE INDEX crawled_posts_reddit_post_idx ON crawled_posts (reddit_post_id);
CREATE INDEX crawled_posts_crawled_at_idx ON crawled_posts (crawled_at);
