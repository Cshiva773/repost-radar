import type pg from 'pg';
import type { Logger } from 'pino';
import { findUserByUsername, insertUser, replacePasswordHash } from './authRepository.js';
import { hashPassword, verifyPassword } from './credentials.js';

const DEFAULT_CREATOR_ID = 1;
const BOOTSTRAP_RETRY_MS = 3000;

export type AdminBootstrapOutcome = 'created' | 'password-updated' | 'unchanged';

export interface AdminBootstrapInstance {
  /** False until the admin row exists; login answers 503 until then rather than counting failures */
  isReady(): boolean;
}

/**
 * The environment is the source of truth for the single v1 admin: the account is created on first
 * start, and changing ADMIN_PASSWORD then restarting rotates the hash and signs out old sessions.
 */
export async function ensureAdminUser(pool: pg.Pool, adminUsername: string, adminPassword: string): Promise<AdminBootstrapOutcome> {
  const existingUser = await findUserByUsername(pool, adminUsername);
  if (!existingUser) {
    const createdUserId = await insertUser(pool, DEFAULT_CREATOR_ID, adminUsername, await hashPassword(adminPassword));
    if (!createdUserId) throw new Error('Could not create the admin user');
    return 'created';
  }
  if (await verifyPassword(existingUser.passwordHash, adminPassword)) return 'unchanged';
  const isReplaced = await replacePasswordHash(pool, existingUser.userId, await hashPassword(adminPassword));
  if (!isReplaced) throw new Error('Could not update the admin password');
  return 'password-updated';
}

// Retries in the background: on a fresh stack the API starts before `pnpm run migrate` creates the users table
export function startAdminBootstrap(pool: pg.Pool, adminUsername: string, adminPassword: string, logger: Logger): AdminBootstrapInstance {
  const bootstrapState = { isReady: false };
  const attemptBootstrap = (attemptNumber: number) => {
    ensureAdminUser(pool, adminUsername, adminPassword)
      .then((adminOutcome) => {
        bootstrapState.isReady = true;
        logger.info({ adminUsername, adminOutcome, attemptNumber }, 'Step 0: admin account ready');
      })
      .catch((error: Error) => {
        if (attemptNumber === 1) logger.warn({ reason: error.message }, 'Step 0: admin account not ready yet (migrations pending?), retrying');
        setTimeout(() => attemptBootstrap(attemptNumber + 1), BOOTSTRAP_RETRY_MS).unref();
      });
  };
  attemptBootstrap(1);
  return { isReady: () => bootstrapState.isReady };
}
