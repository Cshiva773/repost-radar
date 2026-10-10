import { describe, expect, it } from 'vitest';
import { createSessionToken, hashPassword, hashSessionToken, isLockedOut, loginFailureKey, MAX_LOGIN_FAILURES, verifyPassword } from './credentials.js';

describe('passwords', () => {
  it('hashes with Argon2id and verifies only the right password', async () => {
    const passwordHash = await hashPassword('correct horse battery');
    expect(passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(passwordHash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(passwordHash, 'wrong horse battery')).toBe(false);
  });

  it('treats a malformed stored hash as a failed verify', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });
});

describe('session tokens', () => {
  it('stores only a SHA-256 of a random token', () => {
    const firstToken = createSessionToken();
    const secondToken = createSessionToken();
    expect(firstToken.sessionToken).not.toBe(secondToken.sessionToken);
    expect(firstToken.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(firstToken.sessionToken)).toBe(firstToken.tokenHash);
  });
});

describe('login throttle', () => {
  it('locks out at the failure limit, keyed case-insensitively', () => {
    expect(isLockedOut(MAX_LOGIN_FAILURES - 1)).toBe(false);
    expect(isLockedOut(MAX_LOGIN_FAILURES)).toBe(true);
    expect(loginFailureKey(' Admin ')).toBe(loginFailureKey('admin'));
  });
});
