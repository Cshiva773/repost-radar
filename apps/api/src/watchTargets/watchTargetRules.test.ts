import { describe, expect, it } from 'vitest';
import { exceedsRequestBudget, normaliseSubredditName, parsePollInterval, requestsPerMinuteFor } from './watchTargetRules.js';

describe('normaliseSubredditName', () => {
  it('accepts bare names and strips r/ prefixes', () => {
    expect(normaliseSubredditName('pics')).toBe('pics');
    expect(normaliseSubredditName(' r/EarthPorn/ ')).toBe('EarthPorn');
    expect(normaliseSubredditName('/r/art_')).toBe('art_');
  });

  it('rejects invalid names', () => {
    expect(normaliseSubredditName('a')).toBeUndefined();
    expect(normaliseSubredditName('has space')).toBeUndefined();
    expect(normaliseSubredditName('x'.repeat(22))).toBeUndefined();
    expect(normaliseSubredditName(42)).toBeUndefined();
  });
});

describe('parsePollInterval', () => {
  it('defaults to 300 seconds and enforces the 60 second floor', () => {
    expect(parsePollInterval(undefined)).toBe(300);
    expect(parsePollInterval(120)).toBe(120);
    expect(parsePollInterval(30)).toBeUndefined();
    expect(parsePollInterval('soon')).toBeUndefined();
  });
});

describe('request budget', () => {
  it('sums one request per poll per minute', () => {
    expect(requestsPerMinuteFor([60, 120, 300])).toBeCloseTo(1.7);
  });

  it('allows 50 targets polled every minute but not 51', () => {
    expect(exceedsRequestBudget(Array(50).fill(60))).toBe(false);
    expect(exceedsRequestBudget(Array(51).fill(60))).toBe(true);
  });
});
