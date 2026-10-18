import { redditDefinition } from '@repost-radar/platforms';
import { describe, expect, it } from 'vitest';
import { exceedsRequestBudget, parsePollInterval, requestsPerMinuteFor, resolveWatchTarget } from './watchTargetRules.js';

const ENABLED_PLATFORMS = ['reddit'];

describe('resolveWatchTarget', () => {
  it('accepts { platform, target } and normalises the target', () => {
    expect(resolveWatchTarget({ platform: 'reddit', target: 'r/EarthPorn/' }, ENABLED_PLATFORMS))
      .toMatchObject({ isError: false, targetName: 'EarthPorn', platformDefinition: { platformName: 'reddit' } });
  });

  it('still accepts the original { subreddit } body and defaults the platform to reddit', () => {
    expect(resolveWatchTarget({ subreddit: 'pics' }, ENABLED_PLATFORMS)).toMatchObject({ isError: false, targetName: 'pics' });
  });

  it('rejects unknown or disabled platforms', () => {
    expect(resolveWatchTarget({ platform: 'myspace', target: 'x' }, ENABLED_PLATFORMS)).toMatchObject({ isError: true });
    expect(resolveWatchTarget({ platform: 'reddit', target: 'pics' }, [])).toMatchObject({ isError: true });
  });

  it('rejects a target that is invalid for the platform, naming the platform', () => {
    const resolveResult = resolveWatchTarget({ platform: 'reddit', target: 'has space' }, ENABLED_PLATFORMS);
    expect(resolveResult).toMatchObject({ isError: true });
    if (resolveResult.isError) expect(resolveResult.message).toContain('Reddit subreddit');
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

  it("uses the platform's own limit: Reddit allows 50 targets polled every minute but not 51", () => {
    expect(exceedsRequestBudget(redditDefinition, Array(50).fill(60))).toBe(false);
    expect(exceedsRequestBudget(redditDefinition, Array(51).fill(60))).toBe(true);
  });
});
