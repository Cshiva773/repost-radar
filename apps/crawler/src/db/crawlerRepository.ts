import type pg from 'pg';
import type { CollectedImageDetails } from '../crawl/collectNewPosts.js';

export interface WatchTargetDetails {
  watchTargetId: number;
  platform: string;
  targetName: string;
  pollIntervalSeconds: number;
  lastSeenPostId: string | undefined;
  lastSeenPostedAt: Date | undefined;
  lastCrawledAt: Date | undefined;
}

export interface CrawlOutcomeDetails {
  lastSeenPostId: string | undefined;
  lastSeenPostedAt: Date | undefined;
  postsSeenCount: number;
}

interface WatchTargetRow {
  id: string;
  platform: string;
  target_name: string;
  poll_interval_s: number;
  last_seen_post_id: string | null;
  last_seen_posted_at: Date | null;
  last_crawled_at: Date | null;
}

export async function listEnabledWatchTargets(pool: pg.Pool): Promise<WatchTargetDetails[]> {
  try {
    const queryResult = await pool.query<WatchTargetRow>(
      `SELECT id, platform, target_name, poll_interval_s, last_seen_post_id, last_seen_posted_at, last_crawled_at
       FROM watch_targets WHERE enabled AND deleted_at IS NULL ORDER BY last_crawled_at NULLS FIRST, id`,
    );
    return queryResult.rows.map((watchTargetRow) => ({
      watchTargetId: Number(watchTargetRow.id),
      platform: watchTargetRow.platform,
      targetName: watchTargetRow.target_name,
      pollIntervalSeconds: watchTargetRow.poll_interval_s,
      lastSeenPostId: watchTargetRow.last_seen_post_id ?? undefined,
      lastSeenPostedAt: watchTargetRow.last_seen_posted_at ?? undefined,
      lastCrawledAt: watchTargetRow.last_crawled_at ?? undefined,
    }));
  } catch (error) {
    console.error('listEnabledWatchTargets failed', error);
    return [];
  }
}

// Returns the new row id, or undefined when the post was already stored (re-crawl) or the insert failed
export async function insertCrawledPost(
  pool: pg.Pool,
  watchTarget: Pick<WatchTargetDetails, 'watchTargetId' | 'platform'>,
  collectedImage: CollectedImageDetails,
  storageKey: string,
): Promise<number | undefined> {
  try {
    const queryResult = await pool.query<{ id: string }>(
      `INSERT INTO crawled_posts (watch_target_id, platform, platform_post_id, source_post_id, author, title, url, posted_at, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (platform, platform_post_id) DO NOTHING RETURNING id`,
      [watchTarget.watchTargetId, watchTarget.platform, collectedImage.platformPostId, collectedImage.sourcePostId, collectedImage.author,
        collectedImage.title, collectedImage.permalinkUrl, collectedImage.postedAt, storageKey],
    );
    return queryResult.rows[0] ? Number(queryResult.rows[0].id) : undefined;
  } catch (error) {
    console.error('insertCrawledPost failed', error);
    return undefined;
  }
}

export async function crawledPostExists(pool: pg.Pool, platform: string, platformPostId: string): Promise<boolean> {
  try {
    const queryResult = await pool.query('SELECT 1 FROM crawled_posts WHERE platform = $1 AND platform_post_id = $2', [platform, platformPostId]);
    return (queryResult.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('crawledPostExists failed', error);
    return false;
  }
}

export async function recordCrawlSuccess(pool: pg.Pool, watchTargetId: number, crawlOutcome: CrawlOutcomeDetails): Promise<void> {
  try {
    await pool.query(
      `UPDATE watch_targets SET last_seen_post_id = $2, last_seen_posted_at = $3, last_crawled_at = now(),
         last_error = NULL, posts_seen_count = posts_seen_count + $4 WHERE id = $1`,
      [watchTargetId, crawlOutcome.lastSeenPostId, crawlOutcome.lastSeenPostedAt, crawlOutcome.postsSeenCount],
    );
  } catch (error) {
    console.error('recordCrawlSuccess failed', error);
  }
}

export async function recordCrawlFailure(pool: pg.Pool, watchTargetId: number, errorMessage: string): Promise<void> {
  try {
    await pool.query('UPDATE watch_targets SET last_crawled_at = now(), last_error = $2 WHERE id = $1', [watchTargetId, errorMessage.slice(0, 500)]);
  } catch (error) {
    console.error('recordCrawlFailure failed', error);
  }
}

// Crawled posts older than the retention window whose candidates (if any) were all suppressed
export async function deleteExpiredCrawledPosts(pool: pg.Pool, retentionDays: number): Promise<string[]> {
  try {
    const queryResult = await pool.query<{ storage_key: string | null }>(
      `DELETE FROM crawled_posts cp
       WHERE cp.crawled_at < now() - make_interval(days => $1)
         AND NOT EXISTS (SELECT 1 FROM candidates c WHERE c.crawled_post_id = cp.id AND c.status <> 'suppressed')
       RETURNING cp.storage_key`,
      [retentionDays],
    );
    return queryResult.rows.flatMap((row) => (row.storage_key ? [row.storage_key] : []));
  } catch (error) {
    console.error('deleteExpiredCrawledPosts failed', error);
    return [];
  }
}
