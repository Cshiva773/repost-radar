import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { registerAuthGuard } from './authRoutes.js';
import { createSessionToken, SESSION_COOKIE_NAME } from './credentials.js';

const REVIEWER_ROW = { userId: '1', creatorId: '1', username: 'admin' };

// Stands in for Postgres: only the session lookup is exercised, and it knows a single token hash
function buildFakePool(validTokenHash: string): pg.Pool {
  return {
    query: async (_sql: string, parameterList: unknown[]) => ({ rows: parameterList[0] === validTokenHash ? [REVIEWER_ROW] : [] }),
  } as unknown as pg.Pool;
}

async function buildGuardedServer(validTokenHash: string) {
  const server = Fastify();
  await server.register(cookie);
  registerAuthGuard(server, buildFakePool(validTokenHash));
  server.get('/health', async () => ({ status: 'ok' }));
  server.get('/candidates', async (request) => ({ username: request.reviewer?.username }));
  return server;
}

describe('auth guard', () => {
  const { sessionToken, tokenHash } = createSessionToken();

  it('leaves /health public', async () => {
    const server = await buildGuardedServer(tokenHash);
    expect((await server.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('rejects requests without a session, or with an unknown one, and attaches the reviewer otherwise', async () => {
    const server = await buildGuardedServer(tokenHash);
    expect((await server.inject({ method: 'GET', url: '/candidates' })).statusCode).toBe(401);
    expect((await server.inject({ method: 'GET', url: '/candidates', cookies: { [SESSION_COOKIE_NAME]: 'forged' } })).statusCode).toBe(401);
    const signedInResponse = await server.inject({ method: 'GET', url: '/candidates', cookies: { [SESSION_COOKIE_NAME]: sessionToken } });
    expect(signedInResponse.statusCode).toBe(200);
    expect(signedInResponse.json()).toEqual({ username: 'admin' });
  });

  it('answers unknown routes with 401 rather than revealing which exist', async () => {
    const server = await buildGuardedServer(tokenHash);
    expect((await server.inject({ method: 'GET', url: '/nope' })).statusCode).toBe(401);
  });
});
