// Validation for watch targets, kept pure so it is unit-testable.

export const MIN_POLL_INTERVAL_SECONDS = 60;
export const DEFAULT_POLL_INTERVAL_SECONDS = 300;
// Reddit allows ~60 req/min; the crawler's bucket is 55, and we leave headroom for backfill pages
export const MAX_TOTAL_REQUESTS_PER_MINUTE = 50;

const SUBREDDIT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_]{1,20}$/;

export function normaliseSubredditName(rawSubreddit: unknown): string | undefined {
  if (typeof rawSubreddit !== 'string') return undefined;
  const strippedName = rawSubreddit.trim().replace(/^\/?r\//i, '').replace(/\/$/, '');
  return SUBREDDIT_NAME_PATTERN.test(strippedName) ? strippedName : undefined;
}

export function parsePollInterval(rawInterval: unknown): number | undefined {
  if (rawInterval === undefined) return DEFAULT_POLL_INTERVAL_SECONDS;
  const parsedInterval = Number(rawInterval);
  return Number.isInteger(parsedInterval) && parsedInterval >= MIN_POLL_INTERVAL_SECONDS ? parsedInterval : undefined;
}

// Each poll costs at least one listing request
export function requestsPerMinuteFor(pollIntervalSecondsList: number[]): number {
  return pollIntervalSecondsList.reduce((totalRate, pollIntervalSeconds) => totalRate + 60 / pollIntervalSeconds, 0);
}

export function exceedsRequestBudget(pollIntervalSecondsList: number[]): boolean {
  return requestsPerMinuteFor(pollIntervalSecondsList) > MAX_TOTAL_REQUESTS_PER_MINUTE;
}
