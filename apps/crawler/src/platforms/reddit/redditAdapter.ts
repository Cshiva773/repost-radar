// Registers Reddit with the adapter registry. Everything Reddit-specific stays in this folder.
import type { PlatformAdapterFactory } from '../types.js';
import { createRedditClient } from './redditClient.js';
import { REDDIT_EXISTENCE_BATCH_SIZE } from './postExistence.js';
import { loadRedditConfig } from './redditConfig.js';

const REDDIT_PLATFORM_NAME = 'reddit';

export const redditAdapterFactory: PlatformAdapterFactory = {
  platformName: REDDIT_PLATFORM_NAME,
  createAdapter(environmentDetails, adapterDependencies) {
    const redditConfig = loadRedditConfig(environmentDetails);
    const redditClient = createRedditClient({
      redditConfig,
      tokenBucket: adapterDependencies.createTokenBucket(redditConfig.requestsPerMinute),
      logger: adapterDependencies.logger.child({ platform: REDDIT_PLATFORM_NAME, redditMode: redditConfig.mode }),
      onRequest: (statusCode) => adapterDependencies.onRequest(REDDIT_PLATFORM_NAME, statusCode),
    });
    return {
      platformName: REDDIT_PLATFORM_NAME,
      userAgent: redditConfig.userAgent,
      fetchNewPage: (subreddit, pageCursor) => redditClient.fetchNewPage(subreddit, pageCursor),
      checkPostsExist: (postIdList) => redditClient.checkPostsExist(postIdList),
      existenceBatchSize: REDDIT_EXISTENCE_BATCH_SIZE,
    };
  },
};
