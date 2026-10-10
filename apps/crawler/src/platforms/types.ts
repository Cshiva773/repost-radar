// The contract every platform adapter implements. The crawl loop, paging rules, download cap,
// storage and matching only ever see these platform-neutral shapes.
import type { Logger } from 'pino';
import type { TokenBucketInstance } from './rateLimit.js';

export interface PlatformMediaDetails {
  /** Unique within the platform; becomes crawled_posts.platform_post_id */
  platformPostId: string;
  imageUrl: string;
}

export interface PlatformPostDetails {
  /** Stable id of the post itself (Reddit fullname, Bluesky at:// URI...), used as the paging cursor */
  sourcePostId: string;
  postedAt: Date;
  author: string | undefined;
  title: string | undefined;
  permalinkUrl: string;
  /** Downloadable images in this post; empty for text/video/link posts */
  mediaList: PlatformMediaDetails[];
}

export interface PlatformPageDetails {
  postList: PlatformPostDetails[];
  /** Opaque cursor for the next (older) page, or undefined when there is none */
  nextCursor: string | undefined;
}

export interface PlatformAdapter {
  readonly platformName: string;
  readonly userAgent: string;
  /** Newest-first page of posts for one target (subreddit, hashtag, account...) */
  fetchNewPage(targetName: string, pageCursor: string | undefined): Promise<PlatformPageDetails>;
  /**
   * Optional: which of these posts (by sourcePostId) are still up. Posts absent from the map are
   * unknown and left alone. Platforms without it are never re-checked.
   */
  checkPostsExist?(sourcePostIdList: string[]): Promise<Map<string, boolean>>;
  /** Most sourcePostIds checkPostsExist accepts per call */
  readonly existenceBatchSize?: number;
}

export interface AdapterDependencies {
  logger: Logger;
  onRequest: (platformName: string, statusCode: number) => void;
  createTokenBucket: (requestsPerMinute: number) => TokenBucketInstance;
}

/**
 * How the registry builds an adapter. `createAdapter` reads its own settings from the environment
 * (e.g. REDDIT_*), so enabling a platform is config-only once its factory is registered.
 */
export interface PlatformAdapterFactory {
  readonly platformName: string;
  createAdapter(environmentDetails: NodeJS.ProcessEnv, adapterDependencies: AdapterDependencies): PlatformAdapter;
}
