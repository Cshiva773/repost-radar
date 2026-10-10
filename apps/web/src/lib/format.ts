import type { CandidateStatus } from './api';

const DISPLAY_NAME_BY_PLATFORM: Record<string, string> = { reddit: 'Reddit', bluesky: 'Bluesky' };
const STATUS_LABEL: Record<CandidateStatus, string> = {
  suppressed: 'Suppressed', pending: 'Pending', approved: 'Approved', dismissed: 'Dismissed', legitimate: 'Legitimate', escalated: 'Escalated',
};
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function platformDisplayName(platform: string): string {
  return DISPLAY_NAME_BY_PLATFORM[platform] ?? platform;
}

// Where the copy was found, in the platform's own notation: r/pics, #photography, @someone.bsky.social
export function formatTarget(platform: string, targetName: string): string {
  return platform === 'reddit' ? `r/${targetName}` : targetName;
}

export function formatAuthor(platform: string, postAuthor: string | null): string {
  if (!postAuthor) return 'unknown author';
  return platform === 'reddit' ? `u/${postAuthor}` : `@${postAuthor}`;
}

export function statusLabel(status: CandidateStatus): string {
  return STATUS_LABEL[status];
}

export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function confidenceTone(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.9) return 'high';
  if (confidence >= 0.8) return 'medium';
  return 'low';
}

export function formatRelativeTime(isoTimestamp: string | null, nowMs: number = Date.now()): string {
  if (!isoTimestamp) return 'unknown time';
  const elapsedMs = nowMs - new Date(isoTimestamp).getTime();
  if (elapsedMs < MINUTE_MS) return 'just now';
  if (elapsedMs < HOUR_MS) return `${Math.floor(elapsedMs / MINUTE_MS)} min ago`;
  if (elapsedMs < DAY_MS) return `${Math.floor(elapsedMs / HOUR_MS)} h ago`;
  return `${Math.floor(elapsedMs / DAY_MS)} d ago`;
}

export function formatTimestamp(isoTimestamp: string | null): string {
  if (!isoTimestamp) return '—';
  return new Date(isoTimestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
