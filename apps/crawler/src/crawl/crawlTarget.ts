// One crawl of one watch target: resolve its platform adapter, page new posts, store each new
// image, queue it for matching. Nothing here knows which platform it is talking to.
import type { Logger } from 'pino';
import type pg from 'pg';
import { crawledPostExists, insertCrawledPost, recordCrawlFailure, recordCrawlSuccess, type WatchTargetDetails } from '../db/crawlerRepository.js';
import type { MatchQueueInstance, ObjectStorageInstance } from '../infra.js';
import type { AdapterRegistryInstance } from '../platforms/adapterRegistry.js';
import type { PlatformAdapter } from '../platforms/types.js';
import { collectNewPosts, type CollectedImageDetails, type CollectLimitDetails } from './collectNewPosts.js';
import { downloadImage } from './downloadImage.js';

export interface CrawlDependencies {
  pool: pg.Pool;
  adapterRegistry: AdapterRegistryInstance;
  objectStorage: ObjectStorageInstance;
  matchQueue: MatchQueueInstance;
  logger: Logger;
  maxImageBytes: number;
  collectLimits: Omit<CollectLimitDetails, 'nowMs'>;
}

export interface CrawlSummaryDetails {
  postsSeenCount: number;
  imagesStoredCount: number;
  imagesSkippedCount: number;
}

export function buildCrawledStorageKey(platform: string, platformPostId: string): string {
  return `crawled/${platform}/${platformPostId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

async function storeImage(crawlDependencies: CrawlDependencies, watchTarget: WatchTargetDetails, platformAdapter: PlatformAdapter,
  collectedImage: CollectedImageDetails): Promise<boolean> {
  if (await crawledPostExists(crawlDependencies.pool, watchTarget.platform, collectedImage.platformPostId)) return false;
  const downloadResult = await downloadImage(collectedImage.imageUrl, crawlDependencies.maxImageBytes, platformAdapter.userAgent);
  if (downloadResult.isError) {
    crawlDependencies.logger.info({ platformPostId: collectedImage.platformPostId, reason: downloadResult.reason }, 'Step 3: image skipped');
    return false;
  }
  const storageKey = buildCrawledStorageKey(watchTarget.platform, collectedImage.platformPostId);
  await crawlDependencies.objectStorage.putObject(storageKey, downloadResult.imageBuffer, downloadResult.contentType);
  const crawledPostId = await insertCrawledPost(crawlDependencies.pool, watchTarget, collectedImage, storageKey);
  if (crawledPostId === undefined) return false;
  await crawlDependencies.matchQueue.enqueueMatch(crawledPostId);
  return true;
}

export async function crawlTarget(crawlDependencies: CrawlDependencies, watchTarget: WatchTargetDetails): Promise<CrawlSummaryDetails | undefined> {
  const targetLog = { platform: watchTarget.platform, targetName: watchTarget.targetName };
  const platformAdapter = crawlDependencies.adapterRegistry.resolveAdapter(watchTarget.platform);
  if (!platformAdapter) {
    await recordCrawlFailure(crawlDependencies.pool, watchTarget.watchTargetId, `Platform "${watchTarget.platform}" is not enabled on this crawler (ENABLED_PLATFORMS)`);
    return undefined;
  }
  try {
    crawlDependencies.logger.info(targetLog, 'Step 1: crawling watch target');
    const collectResult = await collectNewPosts(
      (pageCursor) => platformAdapter.fetchNewPage(watchTarget.targetName, pageCursor),
      { lastSeenPostId: watchTarget.lastSeenPostId, lastSeenPostedAt: watchTarget.lastSeenPostedAt },
      { ...crawlDependencies.collectLimits, nowMs: Date.now() },
    );
    let imagesStoredCount = 0;
    for (const collectedImage of collectResult.imageList) {
      if (await storeImage(crawlDependencies, watchTarget, platformAdapter, collectedImage)) imagesStoredCount += 1;
    }
    await recordCrawlSuccess(crawlDependencies.pool, watchTarget.watchTargetId, { ...collectResult.newestCursor, postsSeenCount: collectResult.postsSeenCount });
    const crawlSummary = { postsSeenCount: collectResult.postsSeenCount, imagesStoredCount, imagesSkippedCount: collectResult.imageList.length - imagesStoredCount };
    crawlDependencies.logger.info({ ...targetLog, ...crawlSummary }, 'Step 2: watch target crawled');
    return crawlSummary;
  } catch (error) {
    crawlDependencies.logger.error({ err: error, ...targetLog }, 'Step 2: watch target crawl failed');
    await recordCrawlFailure(crawlDependencies.pool, watchTarget.watchTargetId, error instanceof Error ? error.message : 'Something went wrong');
    return undefined;
  }
}
