// Re-checks the posts behind open candidates. A copy that has been taken down needs no review and no
// notice, and platforms (Bluesky in particular) expect deletions to be respected: open candidates
// close as `removed` and the crawled image is deleted unless an approved candidate still needs it.
import type pg from 'pg';
import type { Logger } from 'pino';
import { listPostsToRecheck, markSourcesChecked, markSourcesRemoved, type RecheckPostDetails } from '../db/crawlerRepository.js';
import type { ObjectStorageInstance } from '../infra.js';
import type { AdapterRegistryInstance } from '../platforms/adapterRegistry.js';
import type { PlatformAdapter } from '../platforms/types.js';

const DEFAULT_EXISTENCE_BATCH_SIZE = 25;
// One batch per platform per run keeps re-checks a small slice of each platform's request budget
const BATCHES_PER_PLATFORM = 1;

export interface RecheckDependencies {
  pool: pg.Pool;
  adapterRegistry: AdapterRegistryInstance;
  objectStorage: ObjectStorageInstance;
  logger: Logger;
}

export interface RecheckOutcomeDetails {
  presentCrawledPostIdList: number[];
  removedCrawledPostIdList: number[];
}

// A gallery shares one source post across several crawled images: ask once per source post
export function uniqueSourcePostIds(postList: RecheckPostDetails[], batchSize: number): string[] {
  return [...new Set(postList.map((recheckPost) => recheckPost.sourcePostId))].slice(0, batchSize * BATCHES_PER_PLATFORM);
}

// Unknown answers (absent from the map) change nothing, so a flaky or partial response never closes a candidate
export function classifyCheckedPosts(postList: RecheckPostDetails[], existenceMap: Map<string, boolean>): RecheckOutcomeDetails {
  const presentCrawledPostIdList = postList.filter((recheckPost) => existenceMap.get(recheckPost.sourcePostId) === true).map((recheckPost) => recheckPost.crawledPostId);
  const removedCrawledPostIdList = postList.filter((recheckPost) => existenceMap.get(recheckPost.sourcePostId) === false).map((recheckPost) => recheckPost.crawledPostId);
  return { presentCrawledPostIdList, removedCrawledPostIdList };
}

async function recheckPlatform(recheckDependencies: RecheckDependencies, platformAdapter: PlatformAdapter, postList: RecheckPostDetails[]): Promise<number> {
  if (!platformAdapter.checkPostsExist) return 0;
  const sourcePostIdList = uniqueSourcePostIds(postList, platformAdapter.existenceBatchSize ?? DEFAULT_EXISTENCE_BATCH_SIZE);
  const checkedPostList = postList.filter((recheckPost) => sourcePostIdList.includes(recheckPost.sourcePostId));
  const existenceMap = await platformAdapter.checkPostsExist(sourcePostIdList);
  const { presentCrawledPostIdList, removedCrawledPostIdList } = classifyCheckedPosts(checkedPostList, existenceMap);
  await markSourcesChecked(recheckDependencies.pool, presentCrawledPostIdList);
  const releasedStorageKeyList = await markSourcesRemoved(recheckDependencies.pool, removedCrawledPostIdList, `The post was removed from ${platformAdapter.platformName}`);
  await recheckDependencies.objectStorage.deleteObjects(releasedStorageKeyList);
  return removedCrawledPostIdList.length;
}

export async function recheckSources(recheckDependencies: RecheckDependencies, recheckAfterHours: number): Promise<void> {
  const postList = await listPostsToRecheck(recheckDependencies.pool, recheckAfterHours);
  for (const platformName of new Set(postList.map((recheckPost) => recheckPost.platform))) {
    const platformAdapter = recheckDependencies.adapterRegistry.resolveAdapter(platformName);
    if (!platformAdapter) continue;
    try {
      const removedCount = await recheckPlatform(recheckDependencies, platformAdapter, postList.filter((recheckPost) => recheckPost.platform === platformName));
      if (removedCount) recheckDependencies.logger.info({ platformName, removedCount }, 'Recheck: copies removed from the platform; candidates closed');
    } catch (error) {
      recheckDependencies.logger.warn({ platformName, err: error }, 'Recheck: existence check failed; will try again next run');
    }
  }
}
