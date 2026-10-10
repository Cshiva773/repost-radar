import { Redis } from 'ioredis';
import pg from 'pg';
import { pino, type Logger } from 'pino';
import { loadCrawlerConfig, type CrawlerConfigDetails } from './config.js';
import { crawlTarget, type CrawlDependencies } from './crawl/crawlTarget.js';
import { selectDueTargets } from './crawl/selectDueTargets.js';
import { deleteExpiredCrawledPosts, listEnabledWatchTargets } from './db/crawlerRepository.js';
import { createMatchQueue, createObjectStorage, recordCrawlRequest } from './infra.js';
import { buildAdapterRegistry } from './platforms/adapterRegistry.js';
import { createTokenBucket } from './platforms/rateLimit.js';

const SHUTDOWN_SIGNAL_LIST: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
const RETENTION_EVERY_TICKS = 60;
const MS_PER_DAY = 86_400_000;

function buildCrawlDependencies(crawlerConfig: CrawlerConfigDetails, pool: pg.Pool, redisClient: Redis, logger: Logger): CrawlDependencies {
  // Every enabled platform gets its own adapter and its own request budget
  const adapterRegistry = buildAdapterRegistry(process.env, {
    logger,
    onRequest: (platformName, statusCode) => void recordCrawlRequest(redisClient, platformName, statusCode),
    createTokenBucket: (requestsPerMinute) => createTokenBucket({ requestsPerMinute }),
  });
  return {
    pool,
    adapterRegistry,
    objectStorage: createObjectStorage(crawlerConfig.objectStorage),
    matchQueue: createMatchQueue(redisClient),
    logger,
    maxImageBytes: crawlerConfig.maxImageBytes,
    collectLimits: {
      backfillMaxPosts: crawlerConfig.backfillMaxPosts,
      backfillMaxAgeMs: crawlerConfig.backfillMaxAgeDays * MS_PER_DAY,
      maxPagesPerCrawl: crawlerConfig.maxPagesPerCrawl,
    },
  };
}

async function runRetention(crawlDependencies: CrawlDependencies, retentionDays: number): Promise<void> {
  const expiredStorageKeyList = await deleteExpiredCrawledPosts(crawlDependencies.pool, retentionDays);
  await crawlDependencies.objectStorage.deleteObjects(expiredStorageKeyList);
  if (expiredStorageKeyList.length) crawlDependencies.logger.info({ deletedCount: expiredStorageKeyList.length }, 'Retention: expired crawled images deleted');
}

async function runTick(crawlDependencies: CrawlDependencies, crawlerConfig: CrawlerConfigDetails, tickCount: number): Promise<void> {
  const dueTargetList = selectDueTargets(await listEnabledWatchTargets(crawlDependencies.pool), Date.now());
  crawlDependencies.logger.debug({ tickCount, dueTargetCount: dueTargetList.length }, 'Crawler tick');
  for (const watchTarget of dueTargetList) await crawlTarget(crawlDependencies, watchTarget);
  if (tickCount % RETENTION_EVERY_TICKS === 1) await runRetention(crawlDependencies, crawlerConfig.retentionDays);
}

async function startCrawler(): Promise<void> {
  const crawlerConfig = loadCrawlerConfig();
  const logger = pino({ level: crawlerConfig.logLevel, base: { service: 'crawler' } });
  const pool = new pg.Pool({ connectionString: crawlerConfig.databaseUrl });
  const redisClient = new Redis(crawlerConfig.redisUrl, { maxRetriesPerRequest: null });
  const crawlDependencies = buildCrawlDependencies(crawlerConfig, pool, redisClient, logger);
  let tickCount = 0;
  let isTickRunning = false;
  let isShuttingDown = false;

  logger.info({ tickSeconds: crawlerConfig.tickSeconds, enabledPlatforms: crawlDependencies.adapterRegistry.listEnabledPlatforms() }, 'Step 0: crawler started');
  const tickOnce = async () => {
    if (isTickRunning || isShuttingDown) return; // a slow crawl must not overlap the next tick
    isTickRunning = true;
    try { await runTick(crawlDependencies, crawlerConfig, ++tickCount); } finally { isTickRunning = false; }
  };
  const tickTimer = setInterval(() => void tickOnce(), crawlerConfig.tickSeconds * 1000);
  void tickOnce();

  const shutdownCrawler = async (signalName: string) => {
    logger.info({ signalName }, 'Shutting down crawler');
    isShuttingDown = true;
    clearInterval(tickTimer);
    await crawlDependencies.matchQueue.close();
    await pool.end();
    redisClient.disconnect();
    process.exit(0);
  };
  for (const signalName of SHUTDOWN_SIGNAL_LIST) process.on(signalName, () => void shutdownCrawler(signalName));
}

startCrawler().catch((error) => {
  console.error('Crawler failed to start', error);
  process.exit(1);
});
