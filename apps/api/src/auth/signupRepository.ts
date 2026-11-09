import type pg from 'pg';
import type { ReviewerDetails } from './authRepository.js';
import type { SignupInputDetails } from './signupRules.js';

const UNIQUE_VIOLATION_CODE = '23505';

export type CreateAccountResult = { isError: false; reviewer: ReviewerDetails } | { isError: true; errorKind: 'duplicate' | 'failed' };

// One transaction: the creator (their private space), their sign-in, and their own copy of the default notice templates
async function insertAccountRows(client: pg.PoolClient, signupInput: SignupInputDetails, passwordHash: string): Promise<ReviewerDetails> {
  const creatorResult = await client.query<{ id: string }>(
    'INSERT INTO creators (name, contact_email) VALUES ($1, $2) RETURNING id', [signupInput.displayName, signupInput.email],
  );
  const creatorId = Number(creatorResult.rows[0]?.id);
  const userResult = await client.query<{ id: string }>(
    'INSERT INTO users (creator_id, username, password_hash) VALUES ($1, $2, $3) RETURNING id', [creatorId, signupInput.email, passwordHash],
  );
  await client.query(
    `INSERT INTO notice_templates (creator_id, platform, name, subject, body)
     SELECT $1, platform, name, subject, body FROM notice_templates WHERE creator_id IS NULL ORDER BY id`, [creatorId],
  );
  return { userId: Number(userResult.rows[0]?.id), creatorId, username: signupInput.email };
}

export async function createCreatorAccount(pool: pg.Pool, signupInput: SignupInputDetails, passwordHash: string): Promise<CreateAccountResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reviewer = await insertAccountRows(client, signupInput, passwordHash);
    await client.query('COMMIT');
    return { isError: false, reviewer };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if ((error as { code?: string }).code === UNIQUE_VIOLATION_CODE) return { isError: true, errorKind: 'duplicate' };
    console.error('createCreatorAccount failed', error);
    return { isError: true, errorKind: 'failed' };
  } finally {
    client.release();
  }
}
