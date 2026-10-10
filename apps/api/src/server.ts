import Fastify, { type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { buildHealthReport, checkPostgres, checkRedis } from './health.js';

const GENERIC_ERROR_MESSAGE = 'Something went wrong';

export interface ServerDependencies {
  pool: pg.Pool;
  redisClient: Redis;
  logLevel: string;
}

export function buildServer(serverDependencies: ServerDependencies): FastifyInstance {
  const server = Fastify({ logger: { level: serverDependencies.logLevel } });

  server.get('/health', async (_request, reply) => {
    const healthReport = buildHealthReport({
      postgres: await checkPostgres(serverDependencies.pool),
      redis: await checkRedis(serverDependencies.redisClient),
    });
    return reply.code(healthReport.status === 'ok' ? 200 : 503).send(healthReport);
  });

  server.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Unhandled route error');
    return reply.code(500).send({ message: GENERIC_ERROR_MESSAGE });
  });

  return server;
}
