import { findPlatformDefinition, type PlatformDefinition } from '@repost-radar/platforms';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type pg from 'pg';
import {
  findWatchTarget, insertWatchTarget, listEnabledPollIntervals, listWatchTargets, softDeleteWatchTarget, updateWatchTarget,
} from './watchTargetRepository.js';
import { exceedsRequestBudget, parsePollInterval, resolveWatchTarget } from './watchTargetRules.js';

const DEFAULT_CREATOR_ID = 1;
const INTERVAL_MESSAGE = 'pollIntervalSeconds must be a whole number of at least 60';

export interface WatchTargetRouteDependencies {
  pool: pg.Pool;
  enabledPlatformList: string[];
}

function sendError(reply: FastifyReply, statusCode: number, message: string) {
  return reply.code(statusCode).send({ isError: true, message });
}

function budgetMessage(platformDefinition: PlatformDefinition): string {
  return `Watching this would exceed ${platformDefinition.maxRequestsPerMinute} ${platformDefinition.displayName} requests per minute. `
    + 'Pause a target or use a longer poll interval.';
}

function parseWatchTargetId(rawParams: unknown): number {
  const watchTargetId = Number((rawParams as { watchTargetId?: string }).watchTargetId);
  return Number.isInteger(watchTargetId) && watchTargetId > 0 ? watchTargetId : 0;
}

export function registerWatchTargetRoutes(server: FastifyInstance, routeDependencies: WatchTargetRouteDependencies): void {
  const { pool, enabledPlatformList } = routeDependencies;

  server.get('/platforms', async () => {
    const platformList = enabledPlatformList.flatMap((platformName) => {
      const platformDefinition = findPlatformDefinition(platformName);
      if (!platformDefinition) return [];
      const { displayName, targetLabel, targetExample, maxRequestsPerMinute } = platformDefinition;
      return [{ platformName, displayName, targetLabel, targetExample, maxRequestsPerMinute }];
    });
    return { platformList, platformCount: platformList.length };
  });

  server.get('/watch-targets', async () => {
    const watchTargetList = await listWatchTargets(pool, DEFAULT_CREATOR_ID);
    return { watchTargetList, watchTargetCount: watchTargetList.length };
  });

  server.post('/watch-targets', async (request, reply) => {
    const requestBody = (request.body ?? {}) as { platform?: unknown; target?: unknown; subreddit?: unknown; pollIntervalSeconds?: unknown };
    const resolveResult = resolveWatchTarget(requestBody, enabledPlatformList);
    if (resolveResult.isError) return sendError(reply, 400, resolveResult.message);
    const pollIntervalSeconds = parsePollInterval(requestBody.pollIntervalSeconds);
    if (!pollIntervalSeconds) return sendError(reply, 400, INTERVAL_MESSAGE);
    const { platformDefinition, targetName } = resolveResult;
    const existingIntervalList = await listEnabledPollIntervals(pool, DEFAULT_CREATOR_ID, platformDefinition.platformName);
    if (exceedsRequestBudget(platformDefinition, [...existingIntervalList, pollIntervalSeconds])) return sendError(reply, 422, budgetMessage(platformDefinition));
    const watchTargetId = await insertWatchTarget(pool, DEFAULT_CREATOR_ID, platformDefinition.platformName, targetName, pollIntervalSeconds);
    if (!watchTargetId) return sendError(reply, 409, `${platformDefinition.displayName} ${platformDefinition.targetLabel} "${targetName}" is already being watched`);
    return reply.code(201).send(await findWatchTarget(pool, watchTargetId));
  });

  server.patch('/watch-targets/:watchTargetId', async (request, reply) => {
    const watchTargetId = parseWatchTargetId(request.params);
    const existingTarget = watchTargetId ? await findWatchTarget(pool, watchTargetId) : undefined;
    const platformDefinition = existingTarget ? findPlatformDefinition(existingTarget.platform) : undefined;
    if (!existingTarget || !platformDefinition) return sendError(reply, 404, 'Watch target not found');
    const requestBody = (request.body ?? {}) as { enabled?: unknown; pollIntervalSeconds?: unknown };
    const enabled = typeof requestBody.enabled === 'boolean' ? requestBody.enabled : existingTarget.enabled;
    const pollIntervalSeconds = requestBody.pollIntervalSeconds === undefined ? existingTarget.pollIntervalSeconds : parsePollInterval(requestBody.pollIntervalSeconds);
    if (!pollIntervalSeconds) return sendError(reply, 400, INTERVAL_MESSAGE);
    const otherIntervalList = await listEnabledPollIntervals(pool, DEFAULT_CREATOR_ID, platformDefinition.platformName, watchTargetId);
    if (enabled && exceedsRequestBudget(platformDefinition, [...otherIntervalList, pollIntervalSeconds])) return sendError(reply, 422, budgetMessage(platformDefinition));
    await updateWatchTarget(pool, watchTargetId, enabled, pollIntervalSeconds);
    return findWatchTarget(pool, watchTargetId);
  });

  server.delete('/watch-targets/:watchTargetId', async (request, reply) => {
    const watchTargetId = parseWatchTargetId(request.params);
    const isDeleted = watchTargetId ? await softDeleteWatchTarget(pool, watchTargetId) : false;
    if (!isDeleted) return sendError(reply, 404, 'Watch target not found');
    return reply.code(204).send();
  });
}
