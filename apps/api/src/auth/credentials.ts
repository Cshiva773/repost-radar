import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

const SESSION_TOKEN_BYTES = 32;
export const SESSION_COOKIE_NAME = 'rr_session';
// Failed logins allowed per username before a cool-down
export const MAX_LOGIN_FAILURES = 10;
export const LOGIN_LOCKOUT_SECONDS = 15 * 60;

export interface SessionTokenDetails {
  sessionToken: string;
  tokenHash: string;
}

// Argon2id with the library defaults (19 MiB memory, 2 passes): OWASP's recommended minimum
export async function hashPassword(plainPassword: string): Promise<string> {
  return hash(plainPassword);
}

export async function verifyPassword(passwordHash: string, plainPassword: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plainPassword);
  } catch (error) {
    console.error('verifyPassword failed on a malformed hash', error);
    return false;
  }
}

export function hashSessionToken(sessionToken: string): string {
  return createHash('sha256').update(sessionToken).digest('hex');
}

export function createSessionToken(): SessionTokenDetails {
  const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  return { sessionToken, tokenHash: hashSessionToken(sessionToken) };
}

export function isLockedOut(failureCount: number): boolean {
  return failureCount >= MAX_LOGIN_FAILURES;
}

export function loginFailureKey(username: string): string {
  return `login-failures:${username.trim().toLowerCase()}`;
}
