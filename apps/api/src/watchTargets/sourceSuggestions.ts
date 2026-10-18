import { findPlatformDefinition } from '@repost-radar/platforms';
import type pg from 'pg';

const SUGGESTION_LIMIT = 10;
const RAW_ROW_LIMIT = 100;

export interface RelatedTargetCountDetails {
  platform: string;
  relatedTarget: string;
  matchCount: number;
}

export interface SourceSuggestionDetails {
  platform: string;
  targetName: string;
  targetUrl: string;
  matchCount: number;
}

export interface WatchedTargetDetails {
  platform: string;
  targetName: string;
}

/**
 * Places that posts matching your work point to (crosspost subreddits, hashtags), counted by distinct
 * matched post. Only open or approved matches count: a dismissed match says nothing about your work.
 */
export async function listRelatedTargetCounts(pool: pg.Pool, creatorId: number): Promise<RelatedTargetCountDetails[]> {
  try {
    const queryResult = await pool.query<{ platform: string; related_target: string; match_count: string }>(
      `SELECT cp.platform, related_target, count(DISTINCT cp.source_post_id) AS match_count
       FROM crawled_posts cp
       JOIN watch_targets wt ON wt.id = cp.watch_target_id
       CROSS JOIN LATERAL unnest(cp.related_targets) AS related_target
       WHERE wt.creator_id = $1
         AND EXISTS (SELECT 1 FROM candidates c WHERE c.crawled_post_id = cp.id AND c.status IN ('pending', 'escalated', 'approved'))
       GROUP BY cp.platform, related_target ORDER BY match_count DESC, related_target LIMIT $2`,
      [creatorId, RAW_ROW_LIMIT],
    );
    return queryResult.rows.map((countRow) => ({ platform: countRow.platform, relatedTarget: countRow.related_target, matchCount: Number(countRow.match_count) }));
  } catch (error) {
    console.error('listRelatedTargetCounts failed', error);
    return [];
  }
}

// Valid on an enabled platform, not already watched, merged after normalising (r/Pics and pics are one)
export function rankSourceSuggestions(countList: RelatedTargetCountDetails[], watchedList: WatchedTargetDetails[], enabledPlatformList: string[]): SourceSuggestionDetails[] {
  const watchedKeySet = new Set(watchedList.map((watched) => `${watched.platform}:${watched.targetName.toLowerCase()}`));
  const suggestionByKey = new Map<string, SourceSuggestionDetails>();
  for (const relatedCount of countList) {
    const platformDefinition = enabledPlatformList.includes(relatedCount.platform) ? findPlatformDefinition(relatedCount.platform) : undefined;
    const targetName = platformDefinition?.normaliseTarget(relatedCount.relatedTarget);
    const suggestionKey = `${relatedCount.platform}:${targetName?.toLowerCase()}`;
    if (!platformDefinition || !targetName || watchedKeySet.has(suggestionKey)) continue;
    const existingSuggestion = suggestionByKey.get(suggestionKey);
    if (existingSuggestion) existingSuggestion.matchCount += relatedCount.matchCount;
    else suggestionByKey.set(suggestionKey, { platform: relatedCount.platform, targetName, targetUrl: platformDefinition.targetUrl(targetName), matchCount: relatedCount.matchCount });
  }
  return [...suggestionByKey.values()].sort((left, right) => right.matchCount - left.matchCount).slice(0, SUGGESTION_LIMIT);
}
