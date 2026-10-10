import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { insertApiToken, listApiTokens, revokeApiToken } from './apiTokenRepository.js';
import { createApiToken } from './credentials.js';

const MAX_TOKEN_NAME_LENGTH = 80;

function readUserId(request: FastifyRequest): number {
  if (!request.reviewer) throw new Error('Route reached without a reviewer');
  return request.reviewer.userId;
}

// Session-only routes (the guard refuses tokens here), so a leaked token cannot mint more tokens
export function registerApiTokenRoutes(server: FastifyInstance, pool: pg.Pool): void {
  server.get('/api-tokens', async (request) => {
    const apiTokenList = await listApiTokens(pool, readUserId(request));
    return { apiTokenList, apiTokenCount: apiTokenList.length };
  });

  server.post('/api-tokens', async (request, reply) => {
    const rawName = (request.body as { name?: unknown } | undefined)?.name;
    const tokenName = typeof rawName === 'string' ? rawName.trim() : '';
    if (!tokenName || tokenName.length > MAX_TOKEN_NAME_LENGTH) return reply.code(400).send({ isError: true, message: `name is required (≤ ${MAX_TOKEN_NAME_LENGTH} characters)` });
    const { apiToken, tokenHash, tokenPrefix } = createApiToken();
    const tokenDetails = await insertApiToken(pool, readUserId(request), tokenName, tokenHash, tokenPrefix);
    if (!tokenDetails) throw new Error('insertApiToken returned nothing');
    // The only time the full token is ever returned
    return reply.code(201).send({ ...tokenDetails, apiToken });
  });

  server.delete('/api-tokens/:tokenId', async (request, reply) => {
    const tokenId = Number((request.params as { tokenId?: string }).tokenId);
    const isRevoked = Number.isInteger(tokenId) && tokenId > 0 ? await revokeApiToken(pool, readUserId(request), tokenId) : false;
    if (!isRevoked) return reply.code(404).send({ isError: true, message: 'Token not found' });
    return reply.code(204).send();
  });
}
