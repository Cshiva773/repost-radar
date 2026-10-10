import { describe, expect, it } from 'vitest';
import { blueskyDefinition, findPlatformDefinition, parseEnabledPlatforms } from './index.js';

describe('blueskyDefinition.normaliseTarget', () => {
  it('accepts hashtags and lowercases them', () => {
    expect(blueskyDefinition.normaliseTarget('#Photography')).toBe('#photography');
    expect(blueskyDefinition.normaliseTarget(' #fotografía ')).toBe('#fotografía');
  });

  it('accepts handles with or without @', () => {
    expect(blueskyDefinition.normaliseTarget('@Artist.bsky.social')).toBe('@artist.bsky.social');
    expect(blueskyDefinition.normaliseTarget('studio.example.com')).toBe('@studio.example.com');
  });

  it('rejects bare words, bad hashtags and bad handles', () => {
    expect(blueskyDefinition.normaliseTarget('photography')).toBeUndefined();
    expect(blueskyDefinition.normaliseTarget('#two words')).toBeUndefined();
    expect(blueskyDefinition.normaliseTarget('#')).toBeUndefined();
    expect(blueskyDefinition.normaliseTarget('@no_underscores.bsky.social')).toBeUndefined();
    expect(blueskyDefinition.normaliseTarget('@-bad.bsky.social')).toBeUndefined();
    expect(blueskyDefinition.normaliseTarget(7)).toBeUndefined();
  });

  it('builds hashtag and profile URLs', () => {
    expect(blueskyDefinition.targetUrl('#photography')).toBe('https://bsky.app/hashtag/photography');
    expect(blueskyDefinition.targetUrl('@artist.bsky.social')).toBe('https://bsky.app/profile/artist.bsky.social');
  });
});

describe('registry with Bluesky', () => {
  it('finds bluesky and can enable it alongside reddit', () => {
    expect(findPlatformDefinition('bluesky')).toBe(blueskyDefinition);
    expect(parseEnabledPlatforms('reddit,bluesky').enabledPlatformList).toEqual(['reddit', 'bluesky']);
  });
});
