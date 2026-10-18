// Smoke-test one platform adapter against the real platform, read-only, without the database:
//   pnpm --filter @repost-radar/crawler smoke bluesky "#photography"
//   pnpm --filter @repost-radar/crawler smoke bluesky @bsky.app
// Prints how many posts and images one page returned. Nothing is downloaded or stored.
import { findPlatformDefinition } from '@repost-radar/platforms';
import { pino } from 'pino';
import { buildAdapterRegistry } from '../src/platforms/adapterRegistry.js';
import { createTokenBucket } from '../src/platforms/rateLimit.js';

async function smokeAdapter(): Promise<void> {
  const [platformName, rawTarget] = process.argv.slice(2);
  const platformDefinition = findPlatformDefinition(platformName);
  const targetName = platformDefinition?.normaliseTarget(rawTarget);
  if (!platformDefinition || !targetName) throw new Error('usage: smoke <platform> <target>, e.g. smoke bluesky "#photography"');

  const logger = pino({ level: 'warn' });
  const adapterRegistry = buildAdapterRegistry({ ...process.env, ENABLED_PLATFORMS: platformDefinition.platformName }, {
    logger, onRequest: () => undefined, createTokenBucket: (requestsPerMinute) => createTokenBucket({ requestsPerMinute }),
  });
  const platformPage = await adapterRegistry.resolveAdapter(platformDefinition.platformName)!.fetchNewPage(targetName, undefined);
  const imageCount = platformPage.postList.reduce((totalCount, platformPost) => totalCount + platformPost.mediaList.length, 0);

  console.log(`${platformDefinition.displayName} ${targetName}: ${platformPage.postList.length} posts, ${imageCount} images, next page: ${platformPage.nextCursor ? 'yes' : 'no'}`);
  const firstImagePost = platformPage.postList.find((platformPost) => platformPost.mediaList.length > 0);
  if (firstImagePost) {
    console.log(`newest image post ${firstImagePost.postedAt.toISOString()} ${firstImagePost.permalinkUrl}`);
    console.log(`  image id ${firstImagePost.mediaList[0]!.platformPostId}`);
  }
}

smokeAdapter().catch((error) => {
  console.error('Smoke test failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
