import { describe, expect, it } from 'vitest';
import { buildCandidateQuery } from './api';
import { confidenceTone, formatAuthor, formatConfidence, formatRelativeTime, formatTarget } from './format';

describe('format helpers', () => {
  it('uses each platform notation for targets and authors', () => {
    expect(formatTarget('reddit', 'pics')).toBe('r/pics');
    expect(formatTarget('bluesky', '#photography')).toBe('#photography');
    expect(formatAuthor('reddit', 'someone')).toBe('u/someone');
    expect(formatAuthor('bluesky', 'someone.bsky.social')).toBe('@someone.bsky.social');
    expect(formatAuthor('bluesky', null)).toBe('unknown author');
  });

  it('formats confidence and buckets it', () => {
    expect(formatConfidence(0.953)).toBe('95%');
    expect([confidenceTone(0.95), confidenceTone(0.85), confidenceTone(0.71)]).toEqual(['high', 'medium', 'low']);
  });

  it('describes elapsed time coarsely', () => {
    const nowMs = Date.parse('2026-10-10T12:00:00Z');
    expect(formatRelativeTime('2026-10-10T11:59:30Z', nowMs)).toBe('just now');
    expect(formatRelativeTime('2026-10-10T11:15:00Z', nowMs)).toBe('45 min ago');
    expect(formatRelativeTime('2026-10-08T12:00:00Z', nowMs)).toBe('2 d ago');
  });

  it('builds the queue query string', () => {
    expect(buildCandidateQuery({ statusList: ['approved', 'dismissed'], sort: 'newest', pageSize: 25, pageOffset: 50, platform: 'bluesky' }))
      .toBe('/candidates?status=approved%2Cdismissed&sort=newest&pageSize=25&pageOffset=50&platform=bluesky');
  });
});
