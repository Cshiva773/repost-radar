import { describe, expect, it } from 'vitest';
import { findPlatformDefinition, parseEnabledPlatforms, redditDefinition } from './index.js';

describe('findPlatformDefinition', () => {
  it('finds a platform case-insensitively and rejects unknown names', () => {
    expect(findPlatformDefinition(' Reddit ')).toBe(redditDefinition);
    expect(findPlatformDefinition('myspace')).toBeUndefined();
    expect(findPlatformDefinition(42)).toBeUndefined();
  });
});

describe('parseEnabledPlatforms', () => {
  it('defaults to reddit', () => {
    expect(parseEnabledPlatforms(undefined)).toEqual({ enabledPlatformList: ['reddit'], unknownPlatformList: [] });
  });

  it('dedupes and reports unknown names separately', () => {
    expect(parseEnabledPlatforms('reddit, REDDIT ,myspace,')).toEqual({ enabledPlatformList: ['reddit'], unknownPlatformList: ['myspace'] });
  });
});

describe('redditDefinition.normaliseTarget', () => {
  it('accepts bare names and strips r/ prefixes', () => {
    expect(redditDefinition.normaliseTarget('pics')).toBe('pics');
    expect(redditDefinition.normaliseTarget(' r/EarthPorn/ ')).toBe('EarthPorn');
    expect(redditDefinition.normaliseTarget('/r/art_')).toBe('art_');
  });

  it('rejects invalid names', () => {
    expect(redditDefinition.normaliseTarget('a')).toBeUndefined();
    expect(redditDefinition.normaliseTarget('has space')).toBeUndefined();
    expect(redditDefinition.normaliseTarget('x'.repeat(22))).toBeUndefined();
    expect(redditDefinition.normaliseTarget(null)).toBeUndefined();
  });

  it('builds the public URL', () => {
    expect(redditDefinition.targetUrl('pics')).toBe('https://www.reddit.com/r/pics/');
  });
});
