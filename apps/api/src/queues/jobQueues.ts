import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export const FINGERPRINT_QUEUE_NAME = 'fingerprint';
export const FINGERPRINT_JOB_NAME = 'fingerprint';

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

export interface JobQueuesInstance {
  enqueueFingerprint(assetId: number): Promise<void>;
  close(): Promise<void>;
}

export function createJobQueues(redisConnection: Redis): JobQueuesInstance {
  const fingerprintQueue = new Queue(FINGERPRINT_QUEUE_NAME, { connection: redisConnection });
  return {
    async enqueueFingerprint(assetId) {
      // Deterministic jobId: enqueueing the same asset twice is a no-op while the job is retained
      await fingerprintQueue.add(FINGERPRINT_JOB_NAME, { assetId }, { ...DEFAULT_JOB_OPTIONS, jobId: `fingerprint-${assetId}` });
    },
    async close() {
      await fingerprintQueue.close();
    },
  };
}
