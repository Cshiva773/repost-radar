import type pg from 'pg';

export interface WatchTargetStatusDetails {
  watchTargetId: number;
  platform: string;
  targetName: string;
  pollIntervalSeconds: number;
  enabled: boolean;
  lastCrawledAt: string | null;
  lastError: string | null;
  postsSeenCount: number;
  candidatesFoundCount: number;
}

const STATUS_SELECT_SQL = `SELECT wt.id AS "watchTargetId", wt.platform, wt.target_name AS "targetName", wt.poll_interval_s AS "pollIntervalSeconds", wt.enabled,
    wt.last_crawled_at AS "lastCrawledAt", wt.last_error AS "lastError", wt.posts_seen_count AS "postsSeenCount",
    (SELECT count(*) FROM candidates c JOIN crawled_posts cp ON cp.id = c.crawled_post_id
     WHERE cp.watch_target_id = wt.id AND c.status <> 'suppressed') AS "candidatesFoundCount"
  FROM watch_targets wt WHERE wt.deleted_at IS NULL`;

function toStatusDetails(statusRow: WatchTargetStatusDetails): WatchTargetStatusDetails {
  return {
    ...statusRow,
    watchTargetId: Number(statusRow.watchTargetId),
    postsSeenCount: Number(statusRow.postsSeenCount),
    candidatesFoundCount: Number(statusRow.candidatesFoundCount),
  };
}

export async function listWatchTargets(pool: pg.Pool, creatorId: number): Promise<WatchTargetStatusDetails[]> {
  try {
    const queryResult = await pool.query<WatchTargetStatusDetails>(`${STATUS_SELECT_SQL} AND wt.creator_id = $1 ORDER BY wt.id`, [creatorId]);
    return queryResult.rows.map(toStatusDetails);
  } catch (error) {
    console.error('listWatchTargets failed', error);
    return [];
  }
}

export async function findWatchTarget(pool: pg.Pool, watchTargetId: number): Promise<WatchTargetStatusDetails | undefined> {
  try {
    const queryResult = await pool.query<WatchTargetStatusDetails>(`${STATUS_SELECT_SQL} AND wt.id = $1`, [watchTargetId]);
    return queryResult.rows[0] ? toStatusDetails(queryResult.rows[0]) : undefined;
  } catch (error) {
    console.error('findWatchTarget failed', error);
    return undefined;
  }
}

export async function listEnabledPollIntervals(pool: pg.Pool, creatorId: number, platform: string, excludedWatchTargetId?: number): Promise<number[]> {
  try {
    const queryResult = await pool.query<{ poll_interval_s: number }>(
      `SELECT poll_interval_s FROM watch_targets
       WHERE creator_id = $1 AND platform = $2 AND enabled AND deleted_at IS NULL AND id <> $3`,
      [creatorId, platform, excludedWatchTargetId ?? 0],
    );
    return queryResult.rows.map((row) => row.poll_interval_s);
  } catch (error) {
    console.error('listEnabledPollIntervals failed', error);
    return [];
  }
}

// Returns the new id, or undefined if this creator already watches that target (or the insert failed)
export async function insertWatchTarget(pool: pg.Pool, creatorId: number, platform: string, targetName: string, pollIntervalSeconds: number): Promise<number | undefined> {
  try {
    const queryResult = await pool.query<{ id: string }>(
      `INSERT INTO watch_targets (creator_id, platform, target_name, poll_interval_s) VALUES ($1, $2, $3, $4)
       ON CONFLICT (creator_id, platform, lower(target_name)) WHERE deleted_at IS NULL DO NOTHING RETURNING id`,
      [creatorId, platform, targetName, pollIntervalSeconds],
    );
    return queryResult.rows[0] ? Number(queryResult.rows[0].id) : undefined;
  } catch (error) {
    console.error('insertWatchTarget failed', error);
    return undefined;
  }
}

export async function updateWatchTarget(pool: pg.Pool, watchTargetId: number, enabled: boolean, pollIntervalSeconds: number): Promise<boolean> {
  try {
    const queryResult = await pool.query(
      'UPDATE watch_targets SET enabled = $2, poll_interval_s = $3 WHERE id = $1 AND deleted_at IS NULL',
      [watchTargetId, enabled, pollIntervalSeconds],
    );
    return (queryResult.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('updateWatchTarget failed', error);
    return false;
  }
}

// Soft delete: candidates already found from this target stay in the queue and audit log
export async function softDeleteWatchTarget(pool: pg.Pool, watchTargetId: number): Promise<boolean> {
  try {
    const queryResult = await pool.query(
      'UPDATE watch_targets SET enabled = false, deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
      [watchTargetId],
    );
    return (queryResult.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('softDeleteWatchTarget failed', error);
    return false;
  }
}
