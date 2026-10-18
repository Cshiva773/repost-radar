import type { PlatformDefinition } from './types.js';

// Targets: "#hashtag" (searchPosts, newest first) or "@handle" (an account's media posts).
const HASHTAG_PATTERN = /^#[\p{L}\p{N}_]{1,64}$/u;
const HANDLE_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

function normaliseHandle(rawHandle: string): string | undefined {
  const handle = rawHandle.replace(/^@/, '').toLowerCase();
  return HANDLE_PATTERN.test(handle) && handle.length <= 253 ? `@${handle}` : undefined;
}

export const blueskyDefinition: PlatformDefinition = {
  platformName: 'bluesky',
  displayName: 'Bluesky',
  targetLabel: 'hashtag or account',
  targetExample: '#photography or @artist.bsky.social',
  // The public AppView's limits are unpublished; stay well under the 3,000 requests / 5 min per-IP PDS limit
  maxRequestsPerMinute: 25,
  normaliseTarget(rawTarget) {
    if (typeof rawTarget !== 'string') return undefined;
    const trimmedTarget = rawTarget.trim();
    if (trimmedTarget.startsWith('#')) return HASHTAG_PATTERN.test(trimmedTarget) ? trimmedTarget.toLowerCase() : undefined;
    if (trimmedTarget.startsWith('@') || trimmedTarget.includes('.')) return normaliseHandle(trimmedTarget);
    return undefined;
  },
  targetUrl(targetName) {
    return targetName.startsWith('#')
      ? `https://bsky.app/hashtag/${encodeURIComponent(targetName.slice(1))}`
      : `https://bsky.app/profile/${targetName.slice(1)}`;
  },
};
