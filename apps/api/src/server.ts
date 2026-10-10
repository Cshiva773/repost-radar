import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { registerAssetRoutes } from './assets/assetRoutes.js';
import type { AdminBootstrapInstance } from './auth/adminBootstrap.js';
import { registerAuthGuard, registerAuthRoutes } from './auth/authRoutes.js';
import { registerCandidateRoutes } from './candidates/candidateRoutes.js';
import { registerEvidencePackRoutes } from './candidates/evidencePackRoutes.js';
import type { AuthConfigDetails } from './config.js';
import { registerCreatorRoutes } from './creator/creatorRoutes.js';
import { MAX_UPLOAD_BYTES } from './assets/imageValidation.js';
import { buildHealthReport, checkPostgres, checkRedis } from './health.js';
import { registerMetricsRoutes } from './metrics/metricsRoutes.js';
import { registerNoticeTemplateRoutes } from './noticeTemplates/noticeTemplateRoutes.js';
import type { JobQueuesInstance } from './queues/jobQueues.js';
import type { ObjectStorageInstance } from './storage/objectStorage.js';
import { registerWatchTargetRoutes } from './watchTargets/watchTargetRoutes.js';

const GENERIC_ERROR_MESSAGE = 'Something went wrong';

export interface ServerDependencies {
  pool: pg.Pool;
  redisClient: Redis;
  objectStorage: ObjectStorageInstance;
  jobQueues: JobQueuesInstance;
  enabledPlatformList: string[];
  authConfig: AuthConfigDetails;
  adminBootstrap: AdminBootstrapInstance;
  logLevel: string;
}

export function buildServer(serverDependencies: ServerDependencies): FastifyInstance {
  const server = Fastify({ logger: { level: serverDependencies.logLevel } });
  void server.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 }, throwFileSizeLimit: true });
  void server.register(cookie);
  // Root-level hook: applies to every route registered below, including those in child scopes
  registerAuthGuard(server, serverDependencies.pool);

  server.get('/health', async (_request, reply) => {
    const healthReport = buildHealthReport({
      postgres: await checkPostgres(serverDependencies.pool),
      redis: await checkRedis(serverDependencies.redisClient),
    });
    return reply.code(healthReport.status === 'ok' ? 200 : 503).send(healthReport);
  });

  void server.register(async (authScope) => registerAuthRoutes(authScope, serverDependencies));
  void server.register(async (assetScope) => registerAssetRoutes(assetScope, serverDependencies));
  void server.register(async (watchTargetScope) => registerWatchTargetRoutes(watchTargetScope, serverDependencies));
  void server.register(async (metricsScope) => registerMetricsRoutes(metricsScope, serverDependencies));
  void server.register(async (candidateScope) => registerCandidateRoutes(candidateScope, serverDependencies));
  void server.register(async (evidenceScope) => registerEvidencePackRoutes(evidenceScope, serverDependencies));
  void server.register(async (templateScope) => registerNoticeTemplateRoutes(templateScope, serverDependencies.pool));
  void server.register(async (creatorScope) => registerCreatorRoutes(creatorScope, serverDependencies.pool));

  server.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode < 500) return reply.code(statusCode).send({ isError: true, message: error.message });
    request.log.error({ err: error }, 'Unhandled route error');
    return reply.code(500).send({ isError: true, message: GENERIC_ERROR_MESSAGE });
  });

  return server;
}
