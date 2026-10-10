import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthConfigDetails } from '../config.js';
import { registerAuthRoutes } from './authRoutes.js';
import { hashPassword, MAX_LOGIN_FAILURES, SESSION_COOKIE_NAME } from './credentials.js';

const AUTH_CONFIG: AuthConfigDetails = { adminUsername: 'admin', adminPassword: 'a-long-local-password', sessionTtlHours: 24, isCookieSecure: false };

// Postgres stand-in: one stored admin; session inserts are recorded
function buildFakePool(passwordHash: string, insertedSessionList: unknown[][]): pg.Pool {
  return {
    query: async (sqlText: string, parameterList: unknown[]) => {
      if (sqlText.includes('FROM users')) {
        return { rows: String(parameterList[0]).toLowerCase() === 'admin' ? [{ userId: '1', creatorId: '1', username: 'admin', passwordHash }] : [] };
      }
      if (sqlText.startsWith('INSERT INTO sessions')) insertedSessionList.push(parameterList);
      return { rows: [], rowCount: 1 };
    },
  } as unknown as pg.Pool;
}

function buildFakeRedis(): Redis {
  const counterMap = new Map<string, number>();
  return {
    get: async (redisKey: string) => (counterMap.has(redisKey) ? String(counterMap.get(redisKey)) : null),
    incr: async (redisKey: string) => { counterMap.set(redisKey, (counterMap.get(redisKey) ?? 0) + 1); return counterMap.get(redisKey); },
    expire: async () => 1,
    del: async (redisKey: string) => { counterMap.delete(redisKey); return 1; },
  } as unknown as Redis;
}

async function buildLoginServer(passwordHash: string, isAdminReady: boolean, insertedSessionList: unknown[][] = []) {
  const server = Fastify();
  await server.register(cookie);
  registerAuthRoutes(server, {
    pool: buildFakePool(passwordHash, insertedSessionList), redisClient: buildFakeRedis(), authConfig: AUTH_CONFIG,
    adminBootstrap: { isReady: () => isAdminReady },
  });
  return server;
}

function postLogin(server: Awaited<ReturnType<typeof buildLoginServer>>, username: string, password: string) {
  return server.inject({ method: 'POST', url: '/auth/login', payload: { username, password } });
}

describe('POST /auth/login', () => {
  let passwordHash = '';
  beforeAll(async () => { passwordHash = await hashPassword(AUTH_CONFIG.adminPassword); });

  it('answers 503 while the admin account is still being created, without counting a failure', async () => {
    const server = await buildLoginServer(passwordHash, false);
    expect((await postLogin(server, 'admin', 'whatever')).statusCode).toBe(503);
  });

  it('sets an HTTP-only, SameSite=Strict session cookie on success', async () => {
    const insertedSessionList: unknown[][] = [];
    const server = await buildLoginServer(passwordHash, true, insertedSessionList);
    const loginResponse = await postLogin(server, 'Admin', AUTH_CONFIG.adminPassword);
    expect(loginResponse.statusCode).toBe(200);
    const sessionCookie = loginResponse.cookies.find((responseCookie) => responseCookie.name === SESSION_COOKIE_NAME);
    expect(sessionCookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(insertedSessionList[0]?.[0]).not.toBe(sessionCookie?.value);
  });

  it('gives the same 401 for a wrong password and an unknown user, then locks out', async () => {
    const server = await buildLoginServer(passwordHash, true);
    const wrongPasswordResponse = await postLogin(server, 'admin', 'not-the-password');
    const unknownUserResponse = await postLogin(server, 'mallory', 'not-the-password');
    expect([wrongPasswordResponse.statusCode, unknownUserResponse.statusCode]).toEqual([401, 401]);
    expect(wrongPasswordResponse.json()).toEqual(unknownUserResponse.json());
    for (let attempt = 1; attempt < MAX_LOGIN_FAILURES; attempt++) await postLogin(server, 'admin', 'not-the-password');
    expect((await postLogin(server, 'admin', AUTH_CONFIG.adminPassword)).statusCode).toBe(429);
  });
});
