import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export const FINGERPRINT_QUEUE_NAME = 'fingerprint';
export const FINGERPRINT_JOB_NAME = 'fingerprint';
export const MATCH_QUEUE_NAME = 'match';
export const EVIDENCE_QUEUE_NAME = 'evidence';
export const EVIDENCE_JOB_NAME = 'evidence';

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};
const COUNTED_JOB_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

export type QueueDepthDetails = Record<string, Record<string, number>>;

export interface JobQueuesInstance {
  enqueueFingerprint(assetId: number): Promise<void>;
  /** isRegeneration: a fresh jobId, so a pack can be rebuilt after a template or profile fix */
  enqueueEvidence(candidateId: number, isRegeneration?: boolean): Promise<void>;
  readQueueDepths(): Promise<QueueDepthDetails>;
  close(): Promise<void>;
}

export function createJobQueues(redisConnection: Redis): JobQueuesInstance {
  const fingerprintQueue = new Queue(FINGERPRINT_QUEUE_NAME, { connection: redisConnection });
  const matchQueue = new Queue(MATCH_QUEUE_NAME, { connection: redisConnection });
  const evidenceQueue = new Queue(EVIDENCE_QUEUE_NAME, { connection: redisConnection });
  return {
    async enqueueFingerprint(assetId) {
      // Deterministic jobId: enqueueing the same asset twice is a no-op while the job is retained
      await fingerprintQueue.add(FINGERPRINT_JOB_NAME, { assetId }, { ...DEFAULT_JOB_OPTIONS, jobId: `fingerprint-${assetId}` });
    },
    async enqueueEvidence(candidateId, isRegeneration = false) {
      const jobId = isRegeneration ? `evidence-${candidateId}-${Date.now()}` : `evidence-${candidateId}`;
      await evidenceQueue.add(EVIDENCE_JOB_NAME, { candidateId }, { ...DEFAULT_JOB_OPTIONS, jobId });
    },
    async readQueueDepths() {
      return {
        [FINGERPRINT_QUEUE_NAME]: await fingerprintQueue.getJobCounts(...COUNTED_JOB_STATES),
        [MATCH_QUEUE_NAME]: await matchQueue.getJobCounts(...COUNTED_JOB_STATES),
        [EVIDENCE_QUEUE_NAME]: await evidenceQueue.getJobCounts(...COUNTED_JOB_STATES),
      };
    },
    async close() {
      await fingerprintQueue.close();
      await matchQueue.close();
      await evidenceQueue.close();
    },
  };
}
