import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { AuthConfigDetails } from '../config.js';
import type { AdminBootstrapInstance } from './adminBootstrap.js';
import { findTokenReviewer } from './apiTokenRepository.js';
import { deleteSession, findSessionReviewer, findUserByUsername, insertSession, type ReviewerDetails } from './authRepository.js';
import {
  addressFailureKey, createSessionToken, hashPassword, hashSessionToken, isLockedOut, LOGIN_LOCKOUT_SECONDS, loginFailureKey, MAX_LOGIN_FAILURES_PER_ADDRESS,
  readBearerApiToken, SESSION_COOKIE_NAME, verifyPassword,
} from './credentials.js';
import { createCreatorAccount } from './signupRepository.js';
import { parseSignupBody } from './signupRules.js';

const MAX_CREDENTIAL_LENGTH = 200;
const INVALID_LOGIN_MESSAGE = 'Wrong email or password';
const TIMING_EQUALISER_PASSWORD = 'repost-radar-timing-equaliser';
const LOCKED_OUT_MESSAGE = 'Too many failed sign-in attempts. Try again in 15 minutes.';
// Sign-ups from one address per hour: enough for a household, slows down scripted account creation
const MAX_SIGNUPS_PER_HOUR = 10;
const SIGNUP_WINDOW_SECONDS = 3600;
// Routes reachable without a session; everything else needs one (sign-up and its on/off switch are public by nature)
const PUBLIC_ROUTE_SET = new Set(['/health', '/auth/login', '/auth/signup', '/auth/options']);

declare module 'fastify' {
  interface FastifyRequest {
    reviewer?: ReviewerDetails;
  }
}

export interface AuthRouteDependencies {
  pool: pg.Pool;
  redisClient: Redis;
  authConfig: AuthConfigDetails;
  adminBootstrap: AdminBootstrapInstance;
}

interface LoginBodyDetails {
  username: string;
  password: string;
}

function parseLoginBody(rawBody: unknown): LoginBodyDetails | undefined {
  const { username, password } = (rawBody ?? {}) as { username?: unknown; password?: unknown };
  const isValidField = (fieldValue: unknown) => typeof fieldValue === 'string' && fieldValue.trim().length > 0 && fieldValue.length <= MAX_CREDENTIAL_LENGTH;
  return isValidField(username) && isValidField(password) ? { username: username as string, password: password as string } : undefined;
}

// Unknown usernames still pay for one Argon2 verify, so response time does not reveal which usernames exist
async function checkCredentials(pool: pg.Pool, loginBody: LoginBodyDetails, dummyPasswordHash: Promise<string>): Promise<ReviewerDetails | undefined> {
  const storedUser = await findUserByUsername(pool, loginBody.username);
  if (!storedUser) {
    await verifyPassword(await dummyPasswordHash, loginBody.password);
    return undefined;
  }
  if (!(await verifyPassword(storedUser.passwordHash, loginBody.password))) return undefined;
  return { userId: storedUser.userId, creatorId: storedUser.creatorId, username: storedUser.username };
}

interface LoginFailureKeyDetails {
  usernameKey: string;
  addressKey: string;
}

// Two limits: per username (guessing one account's password) and per visitor address (trying many accounts)
async function isLoginBlocked(redisClient: Redis, failureKeyDetails: LoginFailureKeyDetails): Promise<boolean> {
  const usernameFailureCount = Number(await redisClient.get(failureKeyDetails.usernameKey) ?? 0);
  const addressFailureCount = Number(await redisClient.get(failureKeyDetails.addressKey) ?? 0);
  return isLockedOut(usernameFailureCount) || addressFailureCount >= MAX_LOGIN_FAILURES_PER_ADDRESS;
}

async function countFailure(redisClient: Redis, failureKey: string): Promise<void> {
  const failureCount = await redisClient.incr(failureKey);
  if (failureCount === 1) await redisClient.expire(failureKey, LOGIN_LOCKOUT_SECONDS);
}

async function recordLoginFailure(redisClient: Redis, failureKeyDetails: LoginFailureKeyDetails): Promise<void> {
  await countFailure(redisClient, failureKeyDetails.usernameKey);
  await countFailure(redisClient, failureKeyDetails.addressKey);
}

async function handleLogin(routeDependencies: AuthRouteDependencies, dummyPasswordHash: Promise<string>, request: FastifyRequest, reply: FastifyReply) {
  const { pool, redisClient, authConfig, adminBootstrap } = routeDependencies;
  if (!adminBootstrap.isReady()) return reply.code(503).send({ isError: true, message: 'Still starting up. Try again in a few seconds.' });
  const loginBody = parseLoginBody(request.body);
  if (!loginBody) return reply.code(400).send({ isError: true, message: 'Enter a username and password' });
  const failureKeyDetails = { usernameKey: loginFailureKey(loginBody.username), addressKey: addressFailureKey(request.ip) };
  if (await isLoginBlocked(redisClient, failureKeyDetails)) return reply.code(429).send({ isError: true, message: LOCKED_OUT_MESSAGE });
  const reviewer = await checkCredentials(pool, loginBody, dummyPasswordHash);
  if (!reviewer) {
    await recordLoginFailure(redisClient, failureKeyDetails);
    request.log.warn({ username: loginBody.username, requestIp: request.ip }, 'Failed sign-in attempt');
    return reply.code(401).send({ isError: true, message: INVALID_LOGIN_MESSAGE });
  }
  // Only the username's count resets: a working account must not wipe an address's record of guessing others
  await redisClient.del(failureKeyDetails.usernameKey);
  await startSession(pool, authConfig, reply, reviewer);
  return { username: reviewer.username };
}

// Shared by sign-in and sign-up: a random token in an HTTP-only cookie, only its hash stored
async function startSession(pool: pg.Pool, authConfig: AuthConfigDetails, reply: FastifyReply, reviewer: ReviewerDetails): Promise<void> {
  const { sessionToken, tokenHash } = createSessionToken();
  if (!(await insertSession(pool, tokenHash, reviewer.userId, authConfig.sessionTtlHours))) throw new Error('Could not store session');
  reply.setCookie(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true, sameSite: 'strict', secure: authConfig.isCookieSecure, path: '/', maxAge: authConfig.sessionTtlHours * 3600,
  });
}

async function isSignupRateLimited(redisClient: Redis, requestIp: string): Promise<boolean> {
  const signupKey = `signups:${requestIp}`;
  const signupCount = await redisClient.incr(signupKey);
  if (signupCount === 1) await redisClient.expire(signupKey, SIGNUP_WINDOW_SECONDS);
  return signupCount > MAX_SIGNUPS_PER_HOUR;
}

// A new creator: their own private space, signed in straight away
async function handleSignup(routeDependencies: AuthRouteDependencies, request: FastifyRequest, reply: FastifyReply) {
  const { pool, redisClient, authConfig } = routeDependencies;
  if (!authConfig.isSignupEnabled) return reply.code(403).send({ isError: true, message: 'Sign-up is turned off on this server' });
  const parseResult = parseSignupBody(request.body);
  if (parseResult.isError) return reply.code(400).send(parseResult);
  if (await isSignupRateLimited(redisClient, request.ip)) {
    return reply.code(429).send({ isError: true, message: 'Too many sign-ups from this network. Try again in an hour.' });
  }
  const accountResult = await createCreatorAccount(pool, parseResult.signupInput, await hashPassword(parseResult.signupInput.password));
  if (accountResult.isError && accountResult.errorKind === 'duplicate') {
    return reply.code(409).send({ isError: true, message: 'An account with this email already exists. Sign in instead.' });
  }
  if (accountResult.isError) throw new Error('createCreatorAccount failed');
  request.log.info({ creatorId: accountResult.reviewer.creatorId }, 'Creator signed up');
  await startSession(pool, authConfig, reply, accountResult.reviewer);
  return reply.code(201).send({ username: accountResult.reviewer.username });
}

// What an API token (the browser extension) may do: check images and read matches. Everything else,
// including deciding, editing and minting tokens, needs a signed-in session.
export const TOKEN_ROUTE_SET = new Set([
  'GET /auth/me', 'POST /checks', 'GET /candidates', 'GET /candidates/:candidateId', 'GET /candidates/:candidateId/notice',
  'GET /candidates/:candidateId/images/:imageRole', 'GET /assets/:assetId/image',
]);

async function authenticateToken(pool: pg.Pool, request: FastifyRequest, apiToken: string): Promise<ReviewerDetails | 'forbidden' | undefined> {
  const reviewer = await findTokenReviewer(pool, hashSessionToken(apiToken));
  if (!reviewer) return undefined;
  return TOKEN_ROUTE_SET.has(`${request.method} ${request.routeOptions.url ?? ''}`) ? reviewer : 'forbidden';
}

export function registerAuthGuard(server: FastifyInstance, pool: pg.Pool): void {
  server.decorateRequest('reviewer', undefined);
  server.addHook('onRequest', async (request, reply) => {
    if (PUBLIC_ROUTE_SET.has(request.routeOptions.url ?? '')) return;
    const apiToken = readBearerApiToken(request.headers.authorization);
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    const reviewer = apiToken
      ? await authenticateToken(pool, request, apiToken)
      : sessionToken ? await findSessionReviewer(pool, hashSessionToken(sessionToken)) : undefined;
    if (reviewer === 'forbidden') return reply.code(403).send({ isError: true, message: 'API tokens cannot use this route; sign in instead' });
    if (!reviewer) return reply.code(401).send({ isError: true, message: 'Sign in to continue' });
    request.reviewer = reviewer;
  });
}

export function registerAuthRoutes(server: FastifyInstance, routeDependencies: AuthRouteDependencies): void {
  const dummyPasswordHash = hashPassword(TIMING_EQUALISER_PASSWORD);
  server.post('/auth/login', async (request, reply) => handleLogin(routeDependencies, dummyPasswordHash, request, reply));
  server.post('/auth/signup', async (request, reply) => handleSignup(routeDependencies, request, reply));
  // Public: lets the sign-in page offer "Create an account" only when the server allows it
  server.get('/auth/options', async () => ({ isSignupEnabled: routeDependencies.authConfig.isSignupEnabled }));

  server.post('/auth/logout', async (request, reply) => {
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    if (sessionToken) await deleteSession(routeDependencies.pool, hashSessionToken(sessionToken));
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });

  server.get('/auth/me', async (request) => ({ username: request.reviewer?.username }));
}
