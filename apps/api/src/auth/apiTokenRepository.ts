import type pg from 'pg';
import type { ReviewerDetails } from './authRepository.js';

export interface ApiTokenDetails {
  tokenId: number;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const TOKEN_COLUMNS_SQL = 'id AS "tokenId", name, token_prefix AS "tokenPrefix", created_at AS "createdAt", last_used_at AS "lastUsedAt"';

function toTokenDetails(tokenRow: ApiTokenDetails): ApiTokenDetails {
  return { ...tokenRow, tokenId: Number(tokenRow.tokenId) };
}

export async function insertApiToken(pool: pg.Pool, userId: number, name: string, tokenHash: string, tokenPrefix: string): Promise<ApiTokenDetails | undefined> {
  try {
    const queryResult = await pool.query<ApiTokenDetails>(
      `INSERT INTO api_tokens (user_id, name, token_hash, token_prefix) VALUES ($1, $2, $3, $4) RETURNING ${TOKEN_COLUMNS_SQL}`,
      [userId, name, tokenHash, tokenPrefix],
    );
    return queryResult.rows[0] ? toTokenDetails(queryResult.rows[0]) : undefined;
  } catch (error) {
    console.error('insertApiToken failed', error);
    return undefined;
  }
}

export async function listApiTokens(pool: pg.Pool, userId: number): Promise<ApiTokenDetails[]> {
  try {
    const queryResult = await pool.query<ApiTokenDetails>(
      `SELECT ${TOKEN_COLUMNS_SQL} FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL ORDER BY id DESC`, [userId],
    );
    return queryResult.rows.map(toTokenDetails);
  } catch (error) {
    console.error('listApiTokens failed', error);
    return [];
  }
}

export async function revokeApiToken(pool: pg.Pool, userId: number, tokenId: number): Promise<boolean> {
  try {
    const queryResult = await pool.query('UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [tokenId, userId]);
    return (queryResult.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('revokeApiToken failed', error);
    return false;
  }
}

// Also stamps last_used_at, so the Settings page shows which tokens are still in use
export async function findTokenReviewer(pool: pg.Pool, tokenHash: string): Promise<ReviewerDetails | undefined> {
  try {
    const queryResult = await pool.query<ReviewerDetails>(
      `UPDATE api_tokens t SET last_used_at = now() FROM users u
       WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND u.id = t.user_id
       RETURNING u.id AS "userId", u.creator_id AS "creatorId", u.username`, [tokenHash],
    );
    const reviewerRow = queryResult.rows[0];
    return reviewerRow ? { ...reviewerRow, userId: Number(reviewerRow.userId), creatorId: Number(reviewerRow.creatorId) } : undefined;
  } catch (error) {
    console.error('findTokenReviewer failed', error);
    return undefined;
  }
}
