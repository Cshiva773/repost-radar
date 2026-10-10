// Walks the `new` listing from the newest post backwards until it reaches what the target
// has already seen, or (on a target's first crawl) until the backfill limits are hit.
import { extractImagePosts, type ImagePostDetails, type ListingPageDetails } from '../reddit/listing.js';

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

export interface CollectResultDetails {
  imagePostList: ImagePostDetails[];
  postsSeenCount: number;
  newestCursor: CrawlCursorDetails;
  pagesFetchedCount: number;
}

type FetchPage = (afterCursor: string | undefined) => Promise<ListingPageDetails>;

function isAlreadySeen(postName: string, postedAt: Date, crawlCursor: CrawlCursorDetails): boolean {
  if (postName === crawlCursor.lastSeenPostId) return true;
  return crawlCursor.lastSeenPostedAt !== undefined && postedAt.getTime() <= crawlCursor.lastSeenPostedAt.getTime();
}

function isPastBackfill(postedAt: Date, postsSeenCount: number, collectLimits: CollectLimitDetails): boolean {
  return postsSeenCount >= collectLimits.backfillMaxPosts || collectLimits.nowMs - postedAt.getTime() > collectLimits.backfillMaxAgeMs;
}

export async function collectNewPosts(fetchPage: FetchPage, crawlCursor: CrawlCursorDetails, collectLimits: CollectLimitDetails): Promise<CollectResultDetails> {
  const isFirstCrawl = crawlCursor.lastSeenPostId === undefined && crawlCursor.lastSeenPostedAt === undefined;
  const collectResult: CollectResultDetails = { imagePostList: [], postsSeenCount: 0, newestCursor: { ...crawlCursor }, pagesFetchedCount: 0 };
  let afterCursor: string | undefined;

  while (collectResult.pagesFetchedCount < collectLimits.maxPagesPerCrawl) {
    const listingPage = await fetchPage(afterCursor);
    collectResult.pagesFetchedCount += 1;
    for (const postData of listingPage.postList) {
      const postedAt = new Date(postData.created_utc * 1000);
      if (!isFirstCrawl && isAlreadySeen(postData.name, postedAt, crawlCursor)) return collectResult;
      if (isFirstCrawl && isPastBackfill(postedAt, collectResult.postsSeenCount, collectLimits)) return collectResult;
      if (collectResult.postsSeenCount === 0) collectResult.newestCursor = { lastSeenPostId: postData.name, lastSeenPostedAt: postedAt };
      collectResult.postsSeenCount += 1;
      collectResult.imagePostList.push(...extractImagePosts(postData));
    }
    if (!listingPage.afterCursor) return collectResult;
    afterCursor = listingPage.afterCursor;
  }
  return collectResult;
}
