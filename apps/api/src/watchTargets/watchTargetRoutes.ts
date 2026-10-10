import type { FastifyInstance, FastifyReply } from 'fastify';
import type pg from 'pg';
import {
  findWatchTarget, insertWatchTarget, listEnabledPollIntervals, listWatchTargets, softDeleteWatchTarget, updateWatchTarget,
} from './watchTargetRepository.js';
import { exceedsRequestBudget, MAX_TOTAL_REQUESTS_PER_MINUTE, normaliseSubredditName, parsePollInterval } from './watchTargetRules.js';

const DEFAULT_CREATOR_ID = 1;
const BUDGET_MESSAGE = `Watching this would exceed ${MAX_TOTAL_REQUESTS_PER_MINUTE} Reddit requests per minute. Pause a target or use a longer poll interval.`;
const INTERVAL_MESSAGE = 'pollIntervalSeconds must be a whole number of at least 60';

function sendError(reply: FastifyReply, statusCode: number, message: string) {
  return reply.code(statusCode).send({ isError: true, message });
}

function parseWatchTargetId(rawParams: unknown): number {
  const watchTargetId = Number((rawParams as { watchTargetId?: string }).watchTargetId);
  return Number.isInteger(watchTargetId) && watchTargetId > 0 ? watchTargetId : 0;
}

export function registerWatchTargetRoutes(server: FastifyInstance, pool: pg.Pool): void {
  server.get('/watch-targets', async () => {
    const watchTargetList = await listWatchTargets(pool, DEFAULT_CREATOR_ID);
    return { watchTargetList, watchTargetCount: watchTargetList.length };
  });

  server.post('/watch-targets', async (request, reply) => {
    const requestBody = (request.body ?? {}) as { subreddit?: unknown; pollIntervalSeconds?: unknown };
    const subreddit = normaliseSubredditName(requestBody.subreddit);
    const pollIntervalSeconds = parsePollInterval(requestBody.pollIntervalSeconds);
    if (!subreddit) return sendError(reply, 400, 'subreddit must be a valid subreddit name, e.g. "pics" or "r/pics"');
    if (!pollIntervalSeconds) return sendError(reply, 400, INTERVAL_MESSAGE);
    if (exceedsRequestBudget([...(await listEnabledPollIntervals(pool, DEFAULT_CREATOR_ID)), pollIntervalSeconds])) {
      return sendError(reply, 422, BUDGET_MESSAGE);
    }
    const watchTargetId = await insertWatchTarget(pool, DEFAULT_CREATOR_ID, subreddit, pollIntervalSeconds);
    if (!watchTargetId) return sendError(reply, 409, `r/${subreddit} is already being watched`);
    return reply.code(201).send(await findWatchTarget(pool, watchTargetId));
  });

  server.patch('/watch-targets/:watchTargetId', async (request, reply) => {
    const watchTargetId = parseWatchTargetId(request.params);
    const existingTarget = watchTargetId ? await findWatchTarget(pool, watchTargetId) : undefined;
    if (!existingTarget) return sendError(reply, 404, 'Watch target not found');
    const requestBody = (request.body ?? {}) as { enabled?: unknown; pollIntervalSeconds?: unknown };
    const enabled = typeof requestBody.enabled === 'boolean' ? requestBody.enabled : existingTarget.enabled;
    const pollIntervalSeconds = requestBody.pollIntervalSeconds === undefined ? existingTarget.pollIntervalSeconds : parsePollInterval(requestBody.pollIntervalSeconds);
    if (!pollIntervalSeconds) return sendError(reply, 400, INTERVAL_MESSAGE);
    if (enabled && exceedsRequestBudget([...(await listEnabledPollIntervals(pool, DEFAULT_CREATOR_ID, watchTargetId)), pollIntervalSeconds])) {
      return sendError(reply, 422, BUDGET_MESSAGE);
    }
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
