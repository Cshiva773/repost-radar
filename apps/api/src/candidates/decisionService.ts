import type pg from 'pg';
import type { ReviewerDetails } from '../auth/authRepository.js';
import { planDecision, type CandidateStatus, type DecisionInputDetails } from './candidateRules.js';

export type DecisionResult =
  | { isError: false; fromStatus: CandidateStatus; toStatus: CandidateStatus; cascadedCount: number }
  | { isError: true; statusCode: number; message: string };

interface LockedCandidateDetails {
  status: CandidateStatus;
  crawledPostId: number;
}

// Row lock: two reviewers (or two tabs) deciding the same candidate are serialised, and the second gets a 409
async function lockCandidate(client: pg.PoolClient, creatorId: number, candidateId: number): Promise<LockedCandidateDetails | undefined> {
  const queryResult = await client.query<{ status: CandidateStatus; crawled_post_id: string }>(
    `SELECT c.status, c.crawled_post_id FROM candidates c JOIN assets a ON a.id = c.asset_id
     WHERE c.id = $1 AND a.creator_id = $2 FOR UPDATE OF c`, [candidateId, creatorId],
  );
  const lockedRow = queryResult.rows[0];
  return lockedRow ? { status: lockedRow.status, crawledPostId: Number(lockedRow.crawled_post_id) } : undefined;
}

/**
 * "Legitimate" is about the crawled image, not one pairing: flag it so the matcher skips it on any
 * re-run, and close its other open or suppressed candidates with their own audit rows.
 */
async function markImageLegitimate(client: pg.PoolClient, crawledPostId: number, candidateId: number, actor: string): Promise<number> {
  await client.query('UPDATE crawled_posts SET is_legitimate = true WHERE id = $1', [crawledPostId]);
  const cascadeResult = await client.query(
    `WITH previous AS (
       SELECT id, status FROM candidates WHERE crawled_post_id = $1 AND id <> $2 AND status IN ('pending', 'escalated', 'suppressed') FOR UPDATE
     ), closed AS (
       UPDATE candidates c SET status = 'legitimate' FROM previous p WHERE c.id = p.id RETURNING c.id, p.status AS from_status
     )
     INSERT INTO decisions (candidate_id, actor, from_status, to_status, note)
     SELECT id, $3, from_status, 'legitimate', $4 FROM closed`,
    [crawledPostId, candidateId, actor, `Closed automatically: the same image was marked legitimate on candidate #${candidateId}`],
  );
  return cascadeResult.rowCount ?? 0;
}

async function applyDecision(client: pg.PoolClient, reviewer: ReviewerDetails, candidateId: number, decisionInput: DecisionInputDetails): Promise<DecisionResult> {
  const lockedCandidate = await lockCandidate(client, reviewer.creatorId, candidateId);
  if (!lockedCandidate) return { isError: true, statusCode: 404, message: 'Candidate not found' };
  const decisionPlan = planDecision(lockedCandidate.status, decisionInput.action);
  if (decisionPlan.isError) return decisionPlan;
  await client.query('UPDATE candidates SET status = $2, evidence_error = NULL WHERE id = $1', [candidateId, decisionPlan.toStatus]);
  await client.query(
    'INSERT INTO decisions (candidate_id, actor, from_status, to_status, note) VALUES ($1, $2, $3, $4, $5)',
    [candidateId, reviewer.username, lockedCandidate.status, decisionPlan.toStatus, decisionInput.note ?? null],
  );
  const cascadedCount = decisionPlan.toStatus === 'legitimate'
    ? await markImageLegitimate(client, lockedCandidate.crawledPostId, candidateId, reviewer.username) : 0;
  return { isError: false, fromStatus: lockedCandidate.status, toStatus: decisionPlan.toStatus, cascadedCount };
}

// The only code path that changes a candidate's status after matching (docs/ARCHITECTURE.md step 15)
export async function recordDecision(pool: pg.Pool, reviewer: ReviewerDetails, candidateId: number, decisionInput: DecisionInputDetails): Promise<DecisionResult | undefined> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const decisionResult = await applyDecision(client, reviewer, candidateId, decisionInput);
    await client.query(decisionResult.isError ? 'ROLLBACK' : 'COMMIT');
    return decisionResult;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('recordDecision failed', { candidateId, error });
    return undefined;
  } finally {
    client.release();
  }
}
