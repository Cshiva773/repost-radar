const DEFAULT_TICK_SECONDS = 60;
const MINIMUM_TICK_SECONDS = 5;

export interface CrawlerConfigDetails {
  databaseUrl: string;
  redisUrl: string;
  tickSeconds: number;
  logLevel: string;
}

function parseTickSeconds(rawTickSeconds: string | undefined): number {
  const parsedTickSeconds = Number(rawTickSeconds ?? DEFAULT_TICK_SECONDS);
  if (!Number.isFinite(parsedTickSeconds)) return DEFAULT_TICK_SECONDS;
  return Math.max(MINIMUM_TICK_SECONDS, Math.floor(parsedTickSeconds));
}

export function loadCrawlerConfig(environmentDetails: NodeJS.ProcessEnv = process.env): CrawlerConfigDetails {
  const { DATABASE_URL: databaseUrl, REDIS_URL: redisUrl } = environmentDetails;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  if (!redisUrl) throw new Error('REDIS_URL is not set');
  return {
    databaseUrl,
    redisUrl,
    tickSeconds: parseTickSeconds(environmentDetails.CRAWLER_TICK_SECONDS),
    logLevel: environmentDetails.LOG_LEVEL ?? 'info',
  };
}
