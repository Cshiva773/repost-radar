import { Redis } from 'ioredis';
import pg from 'pg';
import { pino, type Logger } from 'pino';
import { loadCrawlerConfig } from './config.js';

const SHUTDOWN_SIGNAL_LIST: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

async function runTick(pool: pg.Pool, redisClient: Redis, logger: Logger, tickCount: number): Promise<void> {
  try {
    await pool.query('SELECT 1');
    await redisClient.ping();
    logger.info({ tickCount }, 'Step 2: crawler tick (phase 0: no targets polled yet)');
  } catch (error) {
    logger.error({ err: error, tickCount }, 'Step 2: crawler tick failed a dependency check');
  }
}

async function startCrawler(): Promise<void> {
  const crawlerConfig = loadCrawlerConfig();
  const logger = pino({ level: crawlerConfig.logLevel, base: { service: 'crawler' } });
  const pool = new pg.Pool({ connectionString: crawlerConfig.databaseUrl });
  const redisClient = new Redis(crawlerConfig.redisUrl, { maxRetriesPerRequest: null });
  let tickCount = 0;

  logger.info({ tickSeconds: crawlerConfig.tickSeconds }, 'Step 1: crawler started');
  const tickTimer = setInterval(() => void runTick(pool, redisClient, logger, ++tickCount), crawlerConfig.tickSeconds * 1000);
  void runTick(pool, redisClient, logger, ++tickCount);

  const shutdownCrawler = async (signalName: string) => {
    logger.info({ signalName }, 'Step 3: shutting down crawler');
    clearInterval(tickTimer);
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
