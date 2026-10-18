// Registers Bluesky with the adapter registry. Everything Bluesky-specific stays in this folder.
import type { PlatformAdapterFactory } from '../types.js';
import { createBlueskyClient } from './blueskyClient.js';
import { loadBlueskyConfig } from './blueskyConfig.js';
import { BLUESKY_EXISTENCE_BATCH_SIZE } from './postExistence.js';

const BLUESKY_PLATFORM_NAME = 'bluesky';

export const blueskyAdapterFactory: PlatformAdapterFactory = {
  platformName: BLUESKY_PLATFORM_NAME,
  createAdapter(environmentDetails, adapterDependencies) {
    const blueskyConfig = loadBlueskyConfig(environmentDetails);
    const blueskyClient = createBlueskyClient({
      blueskyConfig,
      tokenBucket: adapterDependencies.createTokenBucket(blueskyConfig.requestsPerMinute),
      logger: adapterDependencies.logger.child({ platform: BLUESKY_PLATFORM_NAME, signedIn: Boolean(blueskyConfig.identifier) }),
      onRequest: (statusCode) => adapterDependencies.onRequest(BLUESKY_PLATFORM_NAME, statusCode),
    });
    return {
      platformName: BLUESKY_PLATFORM_NAME,
      userAgent: blueskyConfig.userAgent,
      fetchNewPage: (targetName, pageCursor) => blueskyClient.fetchNewPage(targetName, pageCursor),
      checkPostsExist: (postUriList) => blueskyClient.checkPostsExist(postUriList),
      existenceBatchSize: BLUESKY_EXISTENCE_BATCH_SIZE,
    };
  },
};
