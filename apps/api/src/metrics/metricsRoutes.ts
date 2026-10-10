// GET /metrics: plain JSON for v1 (docs/BUILD_TASKS.md phase 2).
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { JobQueuesInstance } from '../queues/jobQueues.js';

const CRAWL_REQUEST_COUNTER_PREFIX = 'metrics:crawl_requests';
const MINUTES_PER_HOUR = 60;

export interface MetricsDependencies {
  pool: pg.Pool;
  redisClient: Redis;
  jobQueues: JobQueuesInstance;
}

// Sums the crawler's per-minute hashes ({statusCode: count}) over the last `minuteCount` minutes
export async function readCrawlRequestCounts(redisClient: Redis, minuteCount: number, nowMs: number = Date.now()): Promise<Record<string, number>> {
  const currentMinute = Math.floor(nowMs / 60_000);
  const requestCountByStatus: Record<string, number> = {};
  try {
    for (let minuteOffset = 0; minuteOffset < minuteCount; minuteOffset += 1) {
      const minuteCounts = await redisClient.hgetall(`${CRAWL_REQUEST_COUNTER_PREFIX}:${currentMinute - minuteOffset}`);
      for (const [statusCode, rawCount] of Object.entries(minuteCounts)) {
        requestCountByStatus[statusCode] = (requestCountByStatus[statusCode] ?? 0) + Number(rawCount);
      }
    }
  } catch (error) {
    console.error('readCrawlRequestCounts failed', error);
  }
  return requestCountByStatus;
}

async function readCandidateCountsLastHour(pool: pg.Pool): Promise<Record<string, number>> {
  try {
    const queryResult = await pool.query<{ status: string; candidate_count: string }>(
      `SELECT status, count(*) AS candidate_count FROM candidates WHERE created_at > now() - interval '1 hour' GROUP BY status`,
    );
    return Object.fromEntries(queryResult.rows.map((row) => [row.status, Number(row.candidate_count)]));
  } catch (error) {
    console.error('readCandidateCountsLastHour failed', error);
    return {};
  }
}

async function readTargetErrors(pool: pg.Pool): Promise<{ subreddit: string; lastError: string; lastCrawledAt: string }[]> {
  try {
    const queryResult = await pool.query<{ subreddit: string; lastError: string; lastCrawledAt: string }>(
      `SELECT subreddit, last_error AS "lastError", last_crawled_at AS "lastCrawledAt"
       FROM watch_targets WHERE deleted_at IS NULL AND last_error IS NOT NULL ORDER BY last_crawled_at DESC`,
    );
    return queryResult.rows;
  } catch (error) {
    console.error('readTargetErrors failed', error);
    return [];
  }
}

function sumCounts(countByKey: Record<string, number>): number {
  return Object.values(countByKey).reduce((totalCount, count) => totalCount + count, 0);
}

export function registerMetricsRoutes(server: FastifyInstance, metricsDependencies: MetricsDependencies): void {
  server.get('/metrics', async () => {
    const requestsLastHourByStatus = await readCrawlRequestCounts(metricsDependencies.redisClient, MINUTES_PER_HOUR);
    return {
      crawlRequestsLastMinute: sumCounts(await readCrawlRequestCounts(metricsDependencies.redisClient, 1)),
      crawlRequestsLastHourByStatus: requestsLastHourByStatus,
      queueDepths: await metricsDependencies.jobQueues.readQueueDepths().catch(() => ({})),
      candidatesLastHourByStatus: await readCandidateCountsLastHour(metricsDependencies.pool),
      watchTargetErrors: await readTargetErrors(metricsDependencies.pool),
    };
  });
}
