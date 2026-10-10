import type pg from 'pg';
import type { CandidateStatus } from './candidateRules.js';

export interface EvidencePackStateDetails {
  status: CandidateStatus;
  evidenceError: string | null;
  zipKey: string | null;
  noticeText: string | null;
  templateId: number | null;
  generatedAt: string | null;
}

export async function findEvidencePackState(pool: pg.Pool, creatorId: number, candidateId: number): Promise<EvidencePackStateDetails | undefined> {
  try {
    const queryResult = await pool.query<EvidencePackStateDetails>(
      `SELECT c.status, c.evidence_error AS "evidenceError", ep.zip_key AS "zipKey", ep.notice_text AS "noticeText",
              ep.template_id AS "templateId", ep.generated_at AS "generatedAt"
       FROM candidates c JOIN assets a ON a.id = c.asset_id LEFT JOIN evidence_packs ep ON ep.candidate_id = c.id
       WHERE a.creator_id = $1 AND c.id = $2`, [creatorId, candidateId],
    );
    const packRow = queryResult.rows[0];
    return packRow ? { ...packRow, templateId: packRow.templateId === null ? null : Number(packRow.templateId) } : undefined;
  } catch (error) {
    console.error('findEvidencePackState failed', error);
    return undefined;
  }
}

export async function updateNoticeText(pool: pg.Pool, candidateId: number, noticeText: string): Promise<boolean> {
  try {
    const queryResult = await pool.query('UPDATE evidence_packs SET notice_text = $2 WHERE candidate_id = $1', [candidateId, noticeText]);
    return (queryResult.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('updateNoticeText failed', error);
    return false;
  }
}

// Cleared when a rebuild is requested, so the review page shows "generating" rather than the stale error
export async function clearEvidenceError(pool: pg.Pool, candidateId: number): Promise<boolean> {
  try {
    await pool.query('UPDATE candidates SET evidence_error = NULL WHERE id = $1', [candidateId]);
    return true;
  } catch (error) {
    console.error('clearEvidenceError failed', error);
    return false;
  }
}
