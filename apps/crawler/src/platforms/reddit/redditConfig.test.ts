import { describe, expect, it } from 'vitest';
import { loadRedditConfig } from './redditConfig.js';

describe('loadRedditConfig', () => {
  it('defaults to fixture mode pointed at the fake Reddit service', () => {
    expect(loadRedditConfig({})).toMatchObject({ mode: 'fixture', apiBaseUrl: 'http://fake-reddit:8090', requestsPerMinute: 55 });
  });

  it('requires credentials in live mode and then targets oauth.reddit.com', () => {
    expect(() => loadRedditConfig({ REDDIT_MODE: 'live' })).toThrow('REDDIT_CLIENT_ID');
    const liveConfig = loadRedditConfig({ REDDIT_MODE: 'live', REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'secret' });
    expect(liveConfig.apiBaseUrl).toBe('https://oauth.reddit.com');
  });

  it('ignores a non-numeric request budget', () => {
    expect(loadRedditConfig({ REDDIT_REQUESTS_PER_MINUTE: 'lots' }).requestsPerMinute).toBe(55);
  });
});
