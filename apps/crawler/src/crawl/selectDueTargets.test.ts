import { describe, expect, it } from 'vitest';
import type { WatchTargetDetails } from '../db/crawlerRepository.js';
import { selectDueTargets } from './selectDueTargets.js';

const NOW_MS = 1_790_000_000_000;

function watchTarget(watchTargetId: number, pollIntervalSeconds: number, secondsSinceCrawl: number | undefined): WatchTargetDetails {
  return {
    watchTargetId,
    subreddit: `sub${watchTargetId}`,
    pollIntervalSeconds,
    lastSeenPostId: undefined,
    lastSeenPostedAt: undefined,
    lastCrawledAt: secondsSinceCrawl === undefined ? undefined : new Date(NOW_MS - secondsSinceCrawl * 1000),
  };
}

describe('selectDueTargets', () => {
  it('includes never-crawled targets and those past their interval, oldest first', () => {
    const dueTargetList = selectDueTargets([
      watchTarget(1, 300, 100),
      watchTarget(2, 300, 600),
      watchTarget(3, 300, undefined),
      watchTarget(4, 300, 300),
    ], NOW_MS);
    expect(dueTargetList.map((target) => target.watchTargetId)).toEqual([3, 2, 4]);
  });

  it('returns an empty list when nothing is due', () => {
    expect(selectDueTargets([watchTarget(1, 3600, 10)], NOW_MS)).toEqual([]);
  });
});
