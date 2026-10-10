import { describe, expect, it } from 'vitest';
import type { PlatformPageDetails, PlatformPostDetails } from '../platforms/types.js';
import { collectNewPosts, type CollectLimitDetails } from './collectNewPosts.js';

const NOW_SECONDS = 1_790_000_000;
const LIMITS: CollectLimitDetails = { backfillMaxPosts: 1000, backfillMaxAgeMs: 7 * 86_400_000, maxPagesPerCrawl: 10, nowMs: NOW_SECONDS * 1000 };

function imagePost(postNumber: number, ageSeconds: number): PlatformPostDetails {
  return {
    sourcePostId: `t3_p${postNumber}`,
    postedAt: new Date((NOW_SECONDS - ageSeconds) * 1000),
    author: undefined,
    title: undefined,
    permalinkUrl: `https://example.com/p${postNumber}`,
    mediaList: [{ platformPostId: `p${postNumber}`, imageUrl: `https://i.redd.it/p${postNumber}.jpg` }],
  };
}

// Newest first, split into pages of `pageSize`
function buildPager(postList: PlatformPostDetails[], pageSize: number) {
  const requestedCursorList: (string | undefined)[] = [];
  const fetchPage = async (afterCursor: string | undefined): Promise<PlatformPageDetails> => {
    requestedCursorList.push(afterCursor);
    const startIndex = afterCursor ? postList.findIndex((post) => post.sourcePostId === afterCursor) + 1 : 0;
    const pagePostList = postList.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < postList.length;
    return { postList: pagePostList, nextCursor: hasMore ? pagePostList.at(-1)?.sourcePostId : undefined };
  };
  return { fetchPage, requestedCursorList };
}

describe('collectNewPosts', () => {
  it('stops at the last seen post on an incremental crawl', async () => {
    const postList = [imagePost(5, 10), imagePost(4, 20), imagePost(3, 30), imagePost(2, 40)];
    const { fetchPage } = buildPager(postList, 2);
    const collectResult = await collectNewPosts(fetchPage, { lastSeenPostId: 't3_p3', lastSeenPostedAt: new Date((NOW_SECONDS - 30) * 1000) }, LIMITS);
    expect(collectResult.imageList.map((post) => post.platformPostId)).toEqual(['p5', 'p4']);
    expect(collectResult.newestCursor.lastSeenPostId).toBe('t3_p5');
  });

  it('stops by timestamp when the last seen post was deleted', async () => {
    const postList = [imagePost(5, 10), imagePost(4, 20), imagePost(2, 40)];
    const { fetchPage } = buildPager(postList, 10);
    const collectResult = await collectNewPosts(fetchPage, { lastSeenPostId: 't3_p3', lastSeenPostedAt: new Date((NOW_SECONDS - 30) * 1000) }, LIMITS);
    expect(collectResult.postsSeenCount).toBe(2);
  });

  it('backfills on a first crawl until posts are older than the age limit', async () => {
    const postList = [imagePost(3, 3600), imagePost(2, 86_400 * 6), imagePost(1, 86_400 * 8)];
    const { fetchPage } = buildPager(postList, 1);
    const collectResult = await collectNewPosts(fetchPage, { lastSeenPostId: undefined, lastSeenPostedAt: undefined }, LIMITS);
    expect(collectResult.imageList.map((post) => post.platformPostId)).toEqual(['p3', 'p2']);
  });

  it('caps a first crawl at the backfill post count', async () => {
    const postList = Array.from({ length: 30 }, (_, index) => imagePost(30 - index, index));
    const { fetchPage } = buildPager(postList, 10);
    const collectResult = await collectNewPosts(fetchPage, { lastSeenPostId: undefined, lastSeenPostedAt: undefined }, { ...LIMITS, backfillMaxPosts: 15 });
    expect(collectResult.postsSeenCount).toBe(15);
  });

  it('never fetches more than maxPagesPerCrawl pages', async () => {
    const postList = Array.from({ length: 50 }, (_, index) => imagePost(50 - index, index));
    const { fetchPage, requestedCursorList } = buildPager(postList, 5);
    await collectNewPosts(fetchPage, { lastSeenPostId: undefined, lastSeenPostedAt: undefined }, { ...LIMITS, maxPagesPerCrawl: 3 });
    expect(requestedCursorList).toHaveLength(3);
  });

  it('keeps the old cursor when nothing new arrived', async () => {
    const lastSeenPostedAt = new Date((NOW_SECONDS - 10) * 1000);
    const { fetchPage } = buildPager([imagePost(5, 10)], 10);
    const collectResult = await collectNewPosts(fetchPage, { lastSeenPostId: 't3_p5', lastSeenPostedAt }, LIMITS);
    expect(collectResult.postsSeenCount).toBe(0);
    expect(collectResult.newestCursor).toEqual({ lastSeenPostId: 't3_p5', lastSeenPostedAt });
  });
});
