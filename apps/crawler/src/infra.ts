// Thin adapters over S3, BullMQ and Redis counters used by the crawl loop.
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { ObjectStorageConfigDetails } from './config.js';

export const MATCH_QUEUE_NAME = 'match';
const CRAWL_REQUEST_COUNTER_PREFIX = 'metrics:crawl_requests';
const COUNTER_TTL_SECONDS = 2 * 60 * 60;

export interface ObjectStorageInstance {
  putObject(storageKey: string, fileBuffer: Buffer, contentType: string): Promise<void>;
  deleteObjects(storageKeyList: string[]): Promise<void>;
}

export interface MatchQueueInstance {
  enqueueMatch(crawledPostId: number): Promise<void>;
  close(): Promise<void>;
}

export function createObjectStorage(objectStorageConfig: ObjectStorageConfigDetails): ObjectStorageInstance {
  const s3Client = new S3Client({
    endpoint: objectStorageConfig.endpoint,
    region: objectStorageConfig.region,
    forcePathStyle: true,
    credentials: { accessKeyId: objectStorageConfig.accessKeyId, secretAccessKey: objectStorageConfig.secretAccessKey },
  });
  return {
    async putObject(storageKey, fileBuffer, contentType) {
      await s3Client.send(new PutObjectCommand({ Bucket: objectStorageConfig.bucketName, Key: storageKey, Body: fileBuffer, ContentType: contentType }));
    },
    async deleteObjects(storageKeyList) {
      if (storageKeyList.length === 0) return;
      await s3Client.send(new DeleteObjectsCommand({
        Bucket: objectStorageConfig.bucketName,
        Delete: { Objects: storageKeyList.map((storageKey) => ({ Key: storageKey })), Quiet: true },
      }));
    },
  };
}

export function createMatchQueue(redisConnection: Redis): MatchQueueInstance {
  const matchQueue = new Queue(MATCH_QUEUE_NAME, { connection: redisConnection });
  return {
    async enqueueMatch(crawledPostId) {
      await matchQueue.add('match', { crawledPostId }, {
        jobId: `match-${crawledPostId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    },
    async close() {
      await matchQueue.close();
    },
  };
}

// Per-minute buckets read back by the API's /metrics endpoint
export async function recordCrawlRequest(redisClient: Redis, statusCode: number): Promise<void> {
  try {
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const counterKey = `${CRAWL_REQUEST_COUNTER_PREFIX}:${minuteBucket}`;
    await redisClient.multi().hincrby(counterKey, String(statusCode), 1).expire(counterKey, COUNTER_TTL_SECONDS).exec();
  } catch {
    // Metrics must never break crawling
  }
}
