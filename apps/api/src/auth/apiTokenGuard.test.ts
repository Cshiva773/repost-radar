import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { registerAuthGuard } from './authRoutes.js';
import { createApiToken, readBearerApiToken } from './credentials.js';

const REVIEWER_ROW = { userId: '1', creatorId: '1', username: 'admin' };

// Only the token lookup (UPDATE api_tokens ... RETURNING) is exercised; it knows one token hash
function buildFakePool(validTokenHash: string): pg.Pool {
  return {
    query: async (sqlText: string, parameterList: unknown[]) => ({
      rows: sqlText.includes('api_tokens') && parameterList[0] === validTokenHash ? [REVIEWER_ROW] : [],
    }),
  } as unknown as pg.Pool;
}

async function buildGuardedServer(validTokenHash: string) {
  const server = Fastify();
  await server.register(cookie);
  registerAuthGuard(server, buildFakePool(validTokenHash));
  server.get('/candidates', async (request) => ({ username: request.reviewer?.username }));
  server.post('/candidates/:candidateId/decision', async () => ({ decided: true }));
  server.post('/api-tokens', async () => ({ minted: true }));
  return server;
}

describe('API tokens in the auth guard', () => {
  const { apiToken, tokenHash } = createApiToken();
  const bearerHeader = { authorization: `Bearer ${apiToken}` };

  it('lets a token read the queue', async () => {
    const server = await buildGuardedServer(tokenHash);
    const listResponse = await server.inject({ method: 'GET', url: '/candidates', headers: bearerHeader });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({ username: 'admin' });
  });

  it('refuses tokens on decisions and token minting with 403, and unknown tokens with 401', async () => {
    const server = await buildGuardedServer(tokenHash);
    expect((await server.inject({ method: 'POST', url: '/candidates/1/decision', headers: bearerHeader })).statusCode).toBe(403);
    expect((await server.inject({ method: 'POST', url: '/api-tokens', headers: bearerHeader })).statusCode).toBe(403);
    expect((await server.inject({ method: 'GET', url: '/candidates', headers: { authorization: `Bearer ${createApiToken().apiToken}` } })).statusCode).toBe(401);
  });

  it('only treats rr_ bearer values as API tokens', () => {
    expect(readBearerApiToken(`Bearer ${apiToken}`)).toBe(apiToken);
    expect(readBearerApiToken('Bearer eyJhbGciOi.jwt')).toBeUndefined();
    expect(readBearerApiToken(undefined)).toBeUndefined();
  });
});
