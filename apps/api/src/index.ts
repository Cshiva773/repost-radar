import { Redis } from 'ioredis';
import pg from 'pg';
import { pino } from 'pino';
import { startAdminBootstrap } from './auth/adminBootstrap.js';
import { listApprovedWithoutPack } from './candidates/candidateRepository.js';
import { loadApiConfig } from './config.js';
import { createJobQueues, type JobQueuesInstance } from './queues/jobQueues.js';
import { buildServer } from './server.js';
import { createObjectStorage } from './storage/objectStorage.js';

const SHUTDOWN_SIGNAL_LIST: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

// Evidence jobs are enqueued after the decision commits; anything lost to a crash in between is picked up here
async function requeueMissingEvidence(pool: pg.Pool, jobQueues: JobQueuesInstance): Promise<number> {
  const candidateIdList = await listApprovedWithoutPack(pool);
  for (const candidateId of candidateIdList) await jobQueues.enqueueEvidence(candidateId);
  return candidateIdList.length;
}

async function startApi(): Promise<void> {
  const apiConfig = loadApiConfig();
  const pool = new pg.Pool({ connectionString: apiConfig.databaseUrl });
  const redisClient = new Redis(apiConfig.redisUrl, { maxRetriesPerRequest: null });
  const jobQueues = createJobQueues(redisClient);
  const objectStorage = createObjectStorage(apiConfig.objectStorage);
  const bootstrapLogger = pino({ level: apiConfig.logLevel, name: 'admin-bootstrap' });
  const adminBootstrap = startAdminBootstrap(pool, apiConfig.auth.adminUsername, apiConfig.auth.adminPassword, bootstrapLogger);
  const server = buildServer({
    pool, redisClient, objectStorage, jobQueues, adminBootstrap,
    enabledPlatformList: apiConfig.enabledPlatformList, authConfig: apiConfig.auth, logLevel: apiConfig.logLevel,
  });

  const shutdownApi = async (signalName: string) => {
    server.log.info({ signalName }, 'Step 2: shutting down API');
    await server.close();
    await jobQueues.close();
    await pool.end();
    redisClient.disconnect();
    process.exit(0);
  };
  for (const signalName of SHUTDOWN_SIGNAL_LIST) process.on(signalName, () => void shutdownApi(signalName));

  await server.listen({ port: apiConfig.port, host: '0.0.0.0' });
  server.log.info({ port: apiConfig.port }, 'Step 1: API listening');
  server.log.info({ requeuedCount: await requeueMissingEvidence(pool, jobQueues) }, 'Step 1b: evidence jobs re-enqueued for approved candidates without a pack');
}

startApi().catch((error) => {
  console.error('API failed to start', error);
  process.exit(1);
});
