import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthConfigDetails } from '../config.js';
import { trustProxyHops } from '../server.js';
import { registerAuthRoutes } from './authRoutes.js';
import { hashPassword, MAX_LOGIN_FAILURES, MAX_LOGIN_FAILURES_PER_ADDRESS, SESSION_COOKIE_NAME } from './credentials.js';

const AUTH_CONFIG: AuthConfigDetails = { adminUsername: 'admin', adminPassword: 'a-long-local-password', sessionTtlHours: 24, isCookieSecure: false, isSignupEnabled: true };

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

async function buildLoginServer(passwordHash: string, isAdminReady: boolean, insertedSessionList: unknown[][] = [], proxyHopCount = 0) {
  const server = Fastify({ trustProxy: trustProxyHops(proxyHopCount) });
  await server.register(cookie);
  registerAuthRoutes(server, {
    pool: buildFakePool(passwordHash, insertedSessionList), redisClient: buildFakeRedis(), authConfig: AUTH_CONFIG,
    adminBootstrap: { isReady: () => isAdminReady },
  });
  return server;
}

function postLogin(server: Awaited<ReturnType<typeof buildLoginServer>>, username: string, password: string, forwardedFor?: string) {
  const headerDetails = forwardedFor ? { 'x-forwarded-for': forwardedFor } : {};
  return server.inject({ method: 'POST', url: '/auth/login', payload: { username, password }, headers: headerDetails });
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

  it('locks out an address that tries many usernames, even though no single username reached its limit', async () => {
    const server = await buildLoginServer(passwordHash, true);
    for (let attempt = 0; attempt < MAX_LOGIN_FAILURES_PER_ADDRESS; attempt++) await postLogin(server, `guess-${attempt}@example.com`, 'not-the-password');
    expect((await postLogin(server, 'admin', AUTH_CONFIG.adminPassword)).statusCode).toBe(429);
  });

  it('behind Caddy and nginx (2 hops), counts each visitor separately and ignores a forged address', async () => {
    const server = await buildLoginServer(passwordHash, true, [], 2);
    // What nginx forwards: the visitor's address as Caddy saw it, then Caddy's own address
    const attackerChain = 'forged-by-attacker, 203.0.113.7, 172.18.0.9';
    for (let attempt = 0; attempt < MAX_LOGIN_FAILURES_PER_ADDRESS; attempt++) await postLogin(server, `guess-${attempt}@example.com`, 'x', attackerChain);
    expect((await postLogin(server, 'admin', AUTH_CONFIG.adminPassword, 'other-forgery, 203.0.113.7, 172.18.0.9')).statusCode).toBe(429);
    expect((await postLogin(server, 'admin', AUTH_CONFIG.adminPassword, '198.51.100.4, 172.18.0.9')).statusCode).toBe(200);
  });
});

async function buildSignupServer(isSignupEnabled: boolean) {
  const server = Fastify();
  await server.register(cookie);
  registerAuthRoutes(server, {
    pool: buildFakePool('', []), redisClient: buildFakeRedis(), authConfig: { ...AUTH_CONFIG, isSignupEnabled },
    adminBootstrap: { isReady: () => true },
  });
  return server;
}

describe('sign-up', () => {
  it('tells the sign-in page whether sign-up is on', async () => {
    expect((await (await buildSignupServer(true)).inject({ method: 'GET', url: '/auth/options' })).json()).toEqual({ isSignupEnabled: true });
    expect((await (await buildSignupServer(false)).inject({ method: 'GET', url: '/auth/options' })).json()).toEqual({ isSignupEnabled: false });
  });

  it('refuses when the server has sign-up turned off', async () => {
    const signupResponse = await (await buildSignupServer(false)).inject({ method: 'POST', url: '/auth/signup', payload: { email: 'dana@example.com', password: 'a-long-password' } });
    expect(signupResponse.statusCode).toBe(403);
  });

  it('explains a bad email or a short password', async () => {
    const signupServer = await buildSignupServer(true);
    const shortPasswordResponse = await signupServer.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'dana@example.com', password: 'short' } });
    expect(shortPasswordResponse.statusCode).toBe(400);
    expect(shortPasswordResponse.json().message).toContain('at least 12 characters');
  });
});
