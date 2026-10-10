import type { PlatformDefinition } from './types.js';

const SUBREDDIT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_]{1,20}$/;

export const redditDefinition: PlatformDefinition = {
  platformName: 'reddit',
  displayName: 'Reddit',
  targetLabel: 'subreddit',
  targetExample: 'r/pics',
  // Reddit allows ~60 req/min per OAuth client; the crawler's bucket is 55 and we keep headroom for backfill
  maxRequestsPerMinute: 50,
  normaliseTarget(rawTarget) {
    if (typeof rawTarget !== 'string') return undefined;
    const strippedName = rawTarget.trim().replace(/^\/?r\//i, '').replace(/\/$/, '');
    return SUBREDDIT_NAME_PATTERN.test(strippedName) ? strippedName : undefined;
  },
  targetUrl(targetName) {
    return `https://www.reddit.com/r/${targetName}/`;
  },
};
