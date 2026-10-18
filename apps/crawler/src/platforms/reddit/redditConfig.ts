// Reddit adapter settings, read from REDDIT_* environment variables.

export type RedditMode = 'live' | 'fixture';

export interface RedditConfigDetails {
  mode: RedditMode;
  apiBaseUrl: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  userAgent: string;
  requestsPerMinute: number;
}

const LIVE_REDDIT_API_BASE = 'https://oauth.reddit.com';
const FIXTURE_REDDIT_API_BASE = 'http://fake-reddit:8090';
const DEFAULT_REQUESTS_PER_MINUTE = 55;

function readPositiveInteger(rawValue: string | undefined, fallbackValue: number): number {
  const parsedValue = Number(rawValue ?? fallbackValue);
  return Number.isFinite(parsedValue) && parsedValue >= 1 ? Math.floor(parsedValue) : fallbackValue;
}

export function loadRedditConfig(environmentDetails: NodeJS.ProcessEnv): RedditConfigDetails {
  const mode: RedditMode = environmentDetails.REDDIT_MODE === 'live' ? 'live' : 'fixture';
  const redditConfig: RedditConfigDetails = {
    mode,
    apiBaseUrl: environmentDetails.REDDIT_API_BASE ?? (mode === 'live' ? LIVE_REDDIT_API_BASE : FIXTURE_REDDIT_API_BASE),
    clientId: environmentDetails.REDDIT_CLIENT_ID || undefined,
    clientSecret: environmentDetails.REDDIT_CLIENT_SECRET || undefined,
    userAgent: environmentDetails.REDDIT_USER_AGENT ?? 'repost-radar/0.1',
    requestsPerMinute: readPositiveInteger(environmentDetails.REDDIT_REQUESTS_PER_MINUTE, DEFAULT_REQUESTS_PER_MINUTE),
  };
  if (mode === 'live' && (!redditConfig.clientId || !redditConfig.clientSecret)) {
    throw new Error('REDDIT_MODE=live needs REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET');
  }
  return redditConfig;
}
