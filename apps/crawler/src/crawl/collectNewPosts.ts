// Walks a target's newest-first feed backwards until it reaches what the target has already seen,
// or (on a target's first crawl) until the backfill limits are hit. Platform-neutral: any adapter's
// pages work here.
import type { PlatformMediaDetails, PlatformPageDetails, PlatformPostDetails } from '../platforms/types.js';

export interface CrawlCursorDetails {
  lastSeenPostId: string | undefined;
  lastSeenPostedAt: Date | undefined;
}

export interface CollectLimitDetails {
  backfillMaxPosts: number;
  backfillMaxAgeMs: number;
  maxPagesPerCrawl: number;
  nowMs: number;
}

/** One downloadable image plus the post it came from */
export type CollectedImageDetails = PlatformMediaDetails & Omit<PlatformPostDetails, 'mediaList'>;

export interface CollectResultDetails {
  imageList: CollectedImageDetails[];
  postsSeenCount: number;
  newestCursor: CrawlCursorDetails;
  pagesFetchedCount: number;
}

type FetchPage = (pageCursor: string | undefined) => Promise<PlatformPageDetails>;

function isAlreadySeen(platformPost: PlatformPostDetails, crawlCursor: CrawlCursorDetails): boolean {
  if (platformPost.sourcePostId === crawlCursor.lastSeenPostId) return true;
  return crawlCursor.lastSeenPostedAt !== undefined && platformPost.postedAt.getTime() <= crawlCursor.lastSeenPostedAt.getTime();
}

function isPastBackfill(platformPost: PlatformPostDetails, postsSeenCount: number, collectLimits: CollectLimitDetails): boolean {
  return postsSeenCount >= collectLimits.backfillMaxPosts || collectLimits.nowMs - platformPost.postedAt.getTime() > collectLimits.backfillMaxAgeMs;
}

function toCollectedImages(platformPost: PlatformPostDetails): CollectedImageDetails[] {
  const { mediaList, ...postDetails } = platformPost;
  return mediaList.map((media) => ({ ...postDetails, ...media }));
}

export async function collectNewPosts(fetchPage: FetchPage, crawlCursor: CrawlCursorDetails, collectLimits: CollectLimitDetails): Promise<CollectResultDetails> {
  const isFirstCrawl = crawlCursor.lastSeenPostId === undefined && crawlCursor.lastSeenPostedAt === undefined;
  const collectResult: CollectResultDetails = { imageList: [], postsSeenCount: 0, newestCursor: { ...crawlCursor }, pagesFetchedCount: 0 };
  let pageCursor: string | undefined;

  while (collectResult.pagesFetchedCount < collectLimits.maxPagesPerCrawl) {
    const platformPage = await fetchPage(pageCursor);
    collectResult.pagesFetchedCount += 1;
    for (const platformPost of platformPage.postList) {
      if (!isFirstCrawl && isAlreadySeen(platformPost, crawlCursor)) return collectResult;
      if (isFirstCrawl && isPastBackfill(platformPost, collectResult.postsSeenCount, collectLimits)) return collectResult;
      if (collectResult.postsSeenCount === 0) {
        collectResult.newestCursor = { lastSeenPostId: platformPost.sourcePostId, lastSeenPostedAt: platformPost.postedAt };
      }
      collectResult.postsSeenCount += 1;
      collectResult.imageList.push(...toCollectedImages(platformPost));
    }
    if (!platformPage.nextCursor) return collectResult;
    pageCursor = platformPage.nextCursor;
  }
  return collectResult;
}
