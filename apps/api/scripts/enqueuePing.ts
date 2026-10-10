// Phase 0 gate helper: puts a `ping` job on the fingerprint queue so we can see
// the Python worker pick it up (`docker compose logs fingerprint-worker`).
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

const FINGERPRINT_QUEUE_NAME = 'fingerprint';
const PING_JOB_NAME = 'ping';

async function enqueuePing(): Promise<void> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const redisConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const fingerprintQueue = new Queue(FINGERPRINT_QUEUE_NAME, { connection: redisConnection });
  try {
    const pingJob = await fingerprintQueue.add(PING_JOB_NAME, { sentAt: new Date().toISOString() });
    console.log(`Step 1: enqueued ${PING_JOB_NAME} job ${pingJob.id} on queue ${FINGERPRINT_QUEUE_NAME}`);
  } finally {
    await fingerprintQueue.close();
    redisConnection.disconnect();
  }
}

enqueuePing().catch((error) => {
  console.error('Failed to enqueue ping job', error);
  process.exit(1);
});
