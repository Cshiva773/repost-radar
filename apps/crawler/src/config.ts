const DEFAULT_TICK_SECONDS = 60;
const MINIMUM_TICK_SECONDS = 5;
const DEFAULT_REQUESTS_PER_MINUTE = 55;
const LIVE_REDDIT_API_BASE = 'https://oauth.reddit.com';

export type RedditMode = 'live' | 'fixture';

export interface RedditConfigDetails {
  mode: RedditMode;
  apiBaseUrl: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  userAgent: string;
  requestsPerMinute: number;
}

export interface ObjectStorageConfigDetails {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  region: string;
}

export interface CrawlerConfigDetails {
  databaseUrl: string;
  redisUrl: string;
  tickSeconds: number;
  logLevel: string;
  reddit: RedditConfigDetails;
  objectStorage: ObjectStorageConfigDetails;
  maxImageBytes: number;
  backfillMaxPosts: number;
  backfillMaxAgeDays: number;
  maxPagesPerCrawl: number;
  retentionDays: number;
}

function readRequired(environmentDetails: NodeJS.ProcessEnv, variableName: string): string {
  const variableValue = environmentDetails[variableName];
  if (!variableValue) throw new Error(`${variableName} is not set`);
  return variableValue;
}

function readNumber(rawValue: string | undefined, fallbackValue: number, minimumValue: number): number {
  const parsedValue = Number(rawValue ?? fallbackValue);
  return Number.isFinite(parsedValue) ? Math.max(minimumValue, Math.floor(parsedValue)) : fallbackValue;
}

function loadRedditConfig(environmentDetails: NodeJS.ProcessEnv): RedditConfigDetails {
  const mode: RedditMode = environmentDetails.REDDIT_MODE === 'live' ? 'live' : 'fixture';
  const redditConfig: RedditConfigDetails = {
    mode,
    apiBaseUrl: environmentDetails.REDDIT_API_BASE ?? (mode === 'live' ? LIVE_REDDIT_API_BASE : 'http://fake-reddit:8090'),
    clientId: environmentDetails.REDDIT_CLIENT_ID || undefined,
    clientSecret: environmentDetails.REDDIT_CLIENT_SECRET || undefined,
    userAgent: environmentDetails.REDDIT_USER_AGENT ?? 'repost-radar/0.1',
    requestsPerMinute: readNumber(environmentDetails.REDDIT_REQUESTS_PER_MINUTE, DEFAULT_REQUESTS_PER_MINUTE, 1),
  };
  if (mode === 'live' && (!redditConfig.clientId || !redditConfig.clientSecret)) {
    throw new Error('REDDIT_MODE=live needs REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET');
  }
  return redditConfig;
}

function loadObjectStorageConfig(environmentDetails: NodeJS.ProcessEnv): ObjectStorageConfigDetails {
  return {
    endpoint: readRequired(environmentDetails, 'S3_ENDPOINT'),
    accessKeyId: readRequired(environmentDetails, 'S3_ACCESS_KEY'),
    secretAccessKey: readRequired(environmentDetails, 'S3_SECRET_KEY'),
    bucketName: readRequired(environmentDetails, 'S3_BUCKET'),
    region: environmentDetails.S3_REGION ?? 'us-east-1',
  };
}

export function loadCrawlerConfig(environmentDetails: NodeJS.ProcessEnv = process.env): CrawlerConfigDetails {
  return {
    databaseUrl: readRequired(environmentDetails, 'DATABASE_URL'),
    redisUrl: readRequired(environmentDetails, 'REDIS_URL'),
    tickSeconds: readNumber(environmentDetails.CRAWLER_TICK_SECONDS, DEFAULT_TICK_SECONDS, MINIMUM_TICK_SECONDS),
    logLevel: environmentDetails.LOG_LEVEL ?? 'info',
    reddit: loadRedditConfig(environmentDetails),
    objectStorage: loadObjectStorageConfig(environmentDetails),
    maxImageBytes: 5 * 1024 * 1024,
    backfillMaxPosts: 1000,
    backfillMaxAgeDays: 7,
    maxPagesPerCrawl: 10,
    retentionDays: readNumber(environmentDetails.RETENTION_DAYS, 7, 1),
  };
}
