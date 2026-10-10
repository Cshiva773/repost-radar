import { Redis } from 'ioredis';
import pg from 'pg';
import { loadApiConfig } from './config.js';
import { buildServer } from './server.js';

const SHUTDOWN_SIGNAL_LIST: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

async function startApi(): Promise<void> {
  const apiConfig = loadApiConfig();
  const pool = new pg.Pool({ connectionString: apiConfig.databaseUrl });
  const redisClient = new Redis(apiConfig.redisUrl, { maxRetriesPerRequest: null });
  const server = buildServer({ pool, redisClient, logLevel: apiConfig.logLevel });

  const shutdownApi = async (signalName: string) => {
    server.log.info({ signalName }, 'Step 2: shutting down API');
    await server.close();
    await pool.end();
    redisClient.disconnect();
    process.exit(0);
  };
  for (const signalName of SHUTDOWN_SIGNAL_LIST) process.on(signalName, () => void shutdownApi(signalName));

  await server.listen({ port: apiConfig.port, host: '0.0.0.0' });
  server.log.info({ port: apiConfig.port }, 'Step 1: API listening');
}

startApi().catch((error) => {
  console.error('API failed to start', error);
  process.exit(1);
});
