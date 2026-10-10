import type pg from 'pg';
import type { CandidateFilterDetails, CandidateStatus } from './candidateRules.js';

export interface CandidateSummaryDetails {
  candidateId: number;
  status: CandidateStatus;
  confidence: number;
  hashDistance: number | null;
  embedSimilarity: number | null;
  createdAt: string;
  assetId: number;
  platform: string;
  targetName: string;
  postAuthor: string | null;
  postTitle: string | null;
  postUrl: string;
  postedAt: string | null;
  hasEvidencePack: boolean;
  evidenceError: string | null;
}

export interface DecisionDetails {
  decisionId: number;
  actor: string;
  fromStatus: CandidateStatus;
  toStatus: CandidateStatus;
  note: string | null;
  decidedAt: string;
}

export interface CandidateDetails extends CandidateSummaryDetails {
  decisionList: DecisionDetails[];
}

export type ImageRole = 'original' | 'candidate';

export interface StoredImageDetails {
  storageKey: string | null;
}

const SUMMARY_SELECT_SQL = `SELECT c.id AS "candidateId", c.status, c.confidence, c.hash_distance AS "hashDistance", c.embed_similarity AS "embedSimilarity",
    c.created_at AS "createdAt", c.asset_id AS "assetId", cp.platform, wt.target_name AS "targetName", cp.author AS "postAuthor",
    cp.title AS "postTitle", cp.url AS "postUrl", cp.posted_at AS "postedAt", ep.id IS NOT NULL AS "hasEvidencePack", c.evidence_error AS "evidenceError"
  FROM candidates c
  JOIN assets a ON a.id = c.asset_id
  JOIN crawled_posts cp ON cp.id = c.crawled_post_id
  JOIN watch_targets wt ON wt.id = cp.watch_target_id
  LEFT JOIN evidence_packs ep ON ep.candidate_id = c.id`;
// $1 creator, $2 statuses, $3 platform, $4 watch target, $5/$6 posted window
const FILTER_WHERE_SQL = `WHERE a.creator_id = $1 AND c.status = ANY($2::candidate_status[])
    AND ($3::text IS NULL OR cp.platform = $3) AND ($4::bigint IS NULL OR wt.id = $4)
    AND ($5::timestamptz IS NULL OR cp.posted_at >= $5) AND ($6::timestamptz IS NULL OR cp.posted_at < $6)`;
const ORDER_BY_SORT = { confidence: 'c.confidence DESC, c.id DESC', newest: 'c.created_at DESC, c.id DESC' } as const;

function toSummaryDetails<RowType extends CandidateSummaryDetails>(candidateRow: RowType): RowType {
  return { ...candidateRow, candidateId: Number(candidateRow.candidateId), assetId: Number(candidateRow.assetId) };
}

function filterParameters(creatorId: number, filterDetails: CandidateFilterDetails): unknown[] {
  return [creatorId, filterDetails.statusList, filterDetails.platform ?? null, filterDetails.watchTargetId ?? null,
    filterDetails.postedAfter ?? null, filterDetails.postedBefore ?? null];
}

export async function listCandidates(pool: pg.Pool, creatorId: number, filterDetails: CandidateFilterDetails): Promise<CandidateSummaryDetails[]> {
  try {
    const queryResult = await pool.query<CandidateSummaryDetails>(
      `${SUMMARY_SELECT_SQL} ${FILTER_WHERE_SQL} ORDER BY ${ORDER_BY_SORT[filterDetails.sort]} LIMIT $7 OFFSET $8`,
      [...filterParameters(creatorId, filterDetails), filterDetails.pageSize, filterDetails.pageOffset],
    );
    return queryResult.rows.map(toSummaryDetails);
  } catch (error) {
    console.error('listCandidates failed', error);
    return [];
  }
}

export async function countCandidates(pool: pg.Pool, creatorId: number, filterDetails: CandidateFilterDetails): Promise<number> {
  try {
    const queryResult = await pool.query<{ total: string }>(
      `SELECT count(*) AS total FROM candidates c JOIN assets a ON a.id = c.asset_id JOIN crawled_posts cp ON cp.id = c.crawled_post_id
       JOIN watch_targets wt ON wt.id = cp.watch_target_id ${FILTER_WHERE_SQL}`,
      filterParameters(creatorId, filterDetails),
    );
    return Number(queryResult.rows[0]?.total ?? 0);
  } catch (error) {
    console.error('countCandidates failed', error);
    return 0;
  }
}

export async function listDecisions(pool: pg.Pool, candidateId: number): Promise<DecisionDetails[]> {
  try {
    const queryResult = await pool.query<DecisionDetails>(
      `SELECT id AS "decisionId", actor, from_status AS "fromStatus", to_status AS "toStatus", note, decided_at AS "decidedAt"
       FROM decisions WHERE candidate_id = $1 ORDER BY decided_at, id`, [candidateId],
    );
    return queryResult.rows.map((decisionRow) => ({ ...decisionRow, decisionId: Number(decisionRow.decisionId) }));
  } catch (error) {
    console.error('listDecisions failed', error);
    return [];
  }
}

export async function findCandidate(pool: pg.Pool, creatorId: number, candidateId: number): Promise<CandidateDetails | undefined> {
  try {
    const queryResult = await pool.query<CandidateSummaryDetails>(`${SUMMARY_SELECT_SQL} WHERE a.creator_id = $1 AND c.id = $2`, [creatorId, candidateId]);
    if (!queryResult.rows[0]) return undefined;
    return { ...toSummaryDetails(queryResult.rows[0]), decisionList: await listDecisions(pool, candidateId) };
  } catch (error) {
    console.error('findCandidate failed', error);
    return undefined;
  }
}

export async function findImageStorageKey(pool: pg.Pool, creatorId: number, candidateId: number, imageRole: ImageRole): Promise<StoredImageDetails | undefined> {
  const keyColumn = imageRole === 'original' ? 'a.storage_key' : 'cp.storage_key';
  try {
    const queryResult = await pool.query<StoredImageDetails>(
      `SELECT ${keyColumn} AS "storageKey" FROM candidates c JOIN assets a ON a.id = c.asset_id
       JOIN crawled_posts cp ON cp.id = c.crawled_post_id WHERE a.creator_id = $1 AND c.id = $2`, [creatorId, candidateId],
    );
    return queryResult.rows[0];
  } catch (error) {
    console.error('findImageStorageKey failed', error);
    return undefined;
  }
}

// Approved candidates whose evidence job never ran to completion (API crashed between commit and enqueue, or the job failed)
export async function listApprovedWithoutPack(pool: pg.Pool): Promise<number[]> {
  try {
    const queryResult = await pool.query<{ id: string }>(
      `SELECT c.id FROM candidates c LEFT JOIN evidence_packs ep ON ep.candidate_id = c.id
       WHERE c.status = 'approved' AND ep.id IS NULL AND c.evidence_error IS NULL`,
    );
    return queryResult.rows.map((candidateRow) => Number(candidateRow.id));
  } catch (error) {
    console.error('listApprovedWithoutPack failed', error);
    return [];
  }
}
