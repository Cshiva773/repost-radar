import type { WatchTargetDetails } from '../db/crawlerRepository.js';

// A target is due when it has never been crawled or its poll interval has elapsed.
// Least-recently-crawled first, so a slow tick cannot starve any one subreddit.
export function selectDueTargets(watchTargetList: WatchTargetDetails[], nowMs: number): WatchTargetDetails[] {
  return watchTargetList
    .filter((watchTarget) => !watchTarget.lastCrawledAt || nowMs - watchTarget.lastCrawledAt.getTime() >= watchTarget.pollIntervalSeconds * 1000)
    .sort((targetA, targetB) => (targetA.lastCrawledAt?.getTime() ?? 0) - (targetB.lastCrawledAt?.getTime() ?? 0));
}
