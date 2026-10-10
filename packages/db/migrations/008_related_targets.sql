-- 008_related_targets: other places a crawled post points to, in the platform's target notation
-- (subreddits it was crossposted to, hashtags it carries). Aggregated over matched posts to suggest
-- sources the creator might want to watch; nothing is crawled until the creator adds one.
ALTER TABLE crawled_posts ADD COLUMN related_targets TEXT[] NOT NULL DEFAULT '{}';
