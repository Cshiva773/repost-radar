// Crawler-wide settings. Each platform adapter reads its own settings (REDDIT_*, ...) when the
// adapter registry builds it, so nothing platform-specific lives here.
const DEFAULT_TICK_SECONDS = 60;
const MINIMUM_TICK_SECONDS = 5;

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
  objectStorage: ObjectStorageConfigDetails;
  maxImageBytes: number;
  backfillMaxPosts: number;
  backfillMaxAgeDays: number;
  maxPagesPerCrawl: number;
  retentionDays: number;
  /** Re-check posts behind open candidates at most this often (SOURCE_RECHECK_HOURS) */
  sourceRecheckHours: number;
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
    objectStorage: loadObjectStorageConfig(environmentDetails),
    maxImageBytes: 5 * 1024 * 1024,
    backfillMaxPosts: 1000,
    backfillMaxAgeDays: 7,
    maxPagesPerCrawl: 10,
    retentionDays: readNumber(environmentDetails.RETENTION_DAYS, 7, 1),
    sourceRecheckHours: readNumber(environmentDetails.SOURCE_RECHECK_HOURS, 6, 1),
  };
}
