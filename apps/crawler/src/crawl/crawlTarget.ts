// One crawl of one watch target: page new posts, store each new image, queue it for matching.
import type { Logger } from 'pino';
import type pg from 'pg';
import { crawledPostExists, insertCrawledPost, recordCrawlFailure, recordCrawlSuccess, type WatchTargetDetails } from '../db/crawlerRepository.js';
import type { MatchQueueInstance, ObjectStorageInstance } from '../infra.js';
import type { ImagePostDetails } from '../reddit/listing.js';
import type { RedditClientInstance } from '../reddit/redditClient.js';
import { collectNewPosts, type CollectLimitDetails } from './collectNewPosts.js';
import { downloadImage } from './downloadImage.js';

export interface CrawlDependencies {
  pool: pg.Pool;
  redditClient: RedditClientInstance;
  objectStorage: ObjectStorageInstance;
  matchQueue: MatchQueueInstance;
  logger: Logger;
  maxImageBytes: number;
  userAgent: string;
  collectLimits: Omit<CollectLimitDetails, 'nowMs'>;
}

export interface CrawlSummaryDetails {
  postsSeenCount: number;
  imagesStoredCount: number;
  imagesSkippedCount: number;
}

function buildCrawledStorageKey(platformPostId: string): string {
  return `crawled/reddit/${platformPostId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

async function storeImagePost(crawlDependencies: CrawlDependencies, watchTargetId: number, imagePost: ImagePostDetails): Promise<boolean> {
  if (await crawledPostExists(crawlDependencies.pool, imagePost.platformPostId)) return false;
  const downloadResult = await downloadImage(imagePost.imageUrl, crawlDependencies.maxImageBytes, crawlDependencies.userAgent);
  if (downloadResult.isError) {
    crawlDependencies.logger.info({ platformPostId: imagePost.platformPostId, reason: downloadResult.reason }, 'Step 3: image skipped');
    return false;
  }
  const storageKey = buildCrawledStorageKey(imagePost.platformPostId);
  await crawlDependencies.objectStorage.putObject(storageKey, downloadResult.imageBuffer, downloadResult.contentType);
  const crawledPostId = await insertCrawledPost(crawlDependencies.pool, watchTargetId, imagePost, storageKey);
  if (crawledPostId === undefined) return false;
  await crawlDependencies.matchQueue.enqueueMatch(crawledPostId);
  return true;
}

export async function crawlTarget(crawlDependencies: CrawlDependencies, watchTarget: WatchTargetDetails): Promise<CrawlSummaryDetails | undefined> {
  const { logger, redditClient } = crawlDependencies;
  try {
    logger.info({ subreddit: watchTarget.subreddit }, 'Step 1: crawling watch target');
    const collectResult = await collectNewPosts(
      (afterCursor) => redditClient.fetchNewPage(watchTarget.subreddit, afterCursor),
      { lastSeenPostId: watchTarget.lastSeenPostId, lastSeenPostedAt: watchTarget.lastSeenPostedAt },
      { ...crawlDependencies.collectLimits, nowMs: Date.now() },
    );
    let imagesStoredCount = 0;
    for (const imagePost of collectResult.imagePostList) {
      if (await storeImagePost(crawlDependencies, watchTarget.watchTargetId, imagePost)) imagesStoredCount += 1;
    }
    await recordCrawlSuccess(crawlDependencies.pool, watchTarget.watchTargetId, { ...collectResult.newestCursor, postsSeenCount: collectResult.postsSeenCount });
    const crawlSummary = { postsSeenCount: collectResult.postsSeenCount, imagesStoredCount, imagesSkippedCount: collectResult.imagePostList.length - imagesStoredCount };
    logger.info({ subreddit: watchTarget.subreddit, ...crawlSummary }, 'Step 2: watch target crawled');
    return crawlSummary;
  } catch (error) {
    logger.error({ err: error, subreddit: watchTarget.subreddit }, 'Step 2: watch target crawl failed');
    await recordCrawlFailure(crawlDependencies.pool, watchTarget.watchTargetId, error instanceof Error ? error.message : 'Something went wrong');
    return undefined;
  }
}
