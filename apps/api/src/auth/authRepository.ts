import type pg from 'pg';

export interface ReviewerDetails {
  userId: number;
  creatorId: number;
  username: string;
}

export interface StoredUserDetails extends ReviewerDetails {
  passwordHash: string;
}

const USER_COLUMNS_SQL = 'u.id AS "userId", u.creator_id AS "creatorId", u.username';

function toReviewerDetails<RowType extends ReviewerDetails>(userRow: RowType): RowType {
  return { ...userRow, userId: Number(userRow.userId), creatorId: Number(userRow.creatorId) };
}

export async function findUserByUsername(pool: pg.Pool, username: string): Promise<StoredUserDetails | undefined> {
  try {
    const queryResult = await pool.query<StoredUserDetails>(
      `SELECT ${USER_COLUMNS_SQL}, u.password_hash AS "passwordHash" FROM users u WHERE lower(u.username) = lower($1)`, [username.trim()],
    );
    return queryResult.rows[0] ? toReviewerDetails(queryResult.rows[0]) : undefined;
  } catch (error) {
    console.error('findUserByUsername failed', error);
    return undefined;
  }
}

export async function insertUser(pool: pg.Pool, creatorId: number, username: string, passwordHash: string): Promise<number | undefined> {
  try {
    const queryResult = await pool.query<{ id: string }>(
      'INSERT INTO users (creator_id, username, password_hash) VALUES ($1, $2, $3) RETURNING id', [creatorId, username.trim(), passwordHash],
    );
    return queryResult.rows[0] ? Number(queryResult.rows[0].id) : undefined;
  } catch (error) {
    console.error('insertUser failed', error);
    return undefined;
  }
}

// Changing the password also ends every session the old password opened
export async function replacePasswordHash(pool: pg.Pool, userId: number, passwordHash: string): Promise<boolean> {
  try {
    await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    return true;
  } catch (error) {
    console.error('replacePasswordHash failed', error);
    return false;
  }
}

export async function insertSession(pool: pg.Pool, tokenHash: string, userId: number, sessionTtlHours: number): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))`, [tokenHash, userId, sessionTtlHours],
    );
    return true;
  } catch (error) {
    console.error('insertSession failed', error);
    return false;
  }
}

export async function findSessionReviewer(pool: pg.Pool, tokenHash: string): Promise<ReviewerDetails | undefined> {
  try {
    const queryResult = await pool.query<ReviewerDetails>(
      `SELECT ${USER_COLUMNS_SQL} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`, [tokenHash],
    );
    return queryResult.rows[0] ? toReviewerDetails(queryResult.rows[0]) : undefined;
  } catch (error) {
    console.error('findSessionReviewer failed', error);
    return undefined;
  }
}

export async function deleteSession(pool: pg.Pool, tokenHash: string): Promise<boolean> {
  try {
    await pool.query('DELETE FROM sessions WHERE token_hash = $1 OR expires_at < now()', [tokenHash]);
    return true;
  } catch (error) {
    console.error('deleteSession failed', error);
    return false;
  }
}
