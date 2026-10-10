import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { buildRequestUrl, createBlueskyClient } from './blueskyClient.js';
import { loadBlueskyConfig } from './blueskyConfig.js';

const PUBLIC_CONFIG = loadBlueskyConfig({});
const SIGNED_IN_CONFIG = loadBlueskyConfig({ BLUESKY_IDENTIFIER: 'me.bsky.social', BLUESKY_APP_PASSWORD: 'xxxx-xxxx' });

describe('buildRequestUrl', () => {
  it('sends hashtags to searchPosts on api.bsky.app, newest first', () => {
    const requestUrl = buildRequestUrl(PUBLIC_CONFIG, '#photography', 'c1', false);
    expect(requestUrl.origin + requestUrl.pathname).toBe('https://api.bsky.app/xrpc/app.bsky.feed.searchPosts');
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({ q: '#photography', sort: 'latest', limit: '100', cursor: 'c1' });
  });

  it('sends accounts to getAuthorFeed on public.api.bsky.app with posts_with_media', () => {
    const requestUrl = buildRequestUrl(PUBLIC_CONFIG, '@artist.bsky.social', undefined, false);
    expect(requestUrl.origin + requestUrl.pathname).toBe('https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed');
    expect(requestUrl.searchParams.get('actor')).toBe('artist.bsky.social');
    expect(requestUrl.searchParams.get('filter')).toBe('posts_with_media');
  });

  it('routes everything through the PDS when signed in', () => {
    expect(buildRequestUrl(SIGNED_IN_CONFIG, '#art', undefined, true).origin).toBe('https://bsky.social');
  });
});

describe('loadBlueskyConfig', () => {
  it('requires identifier and app password together', () => {
    expect(() => loadBlueskyConfig({ BLUESKY_IDENTIFIER: 'me.bsky.social' })).toThrow('both');
  });

  it('excludes adult content unless opted in', () => {
    expect(PUBLIC_CONFIG.includeAdultContent).toBe(false);
    expect(loadBlueskyConfig({ BLUESKY_INCLUDE_ADULT_CONTENT: 'true' }).includeAdultContent).toBe(true);
  });
});

describe('createBlueskyClient', () => {
  it('signs in, then re-signs once when the access token expires', async () => {
    const requestLog: string[] = [];
    let feedCallCount = 0;
    const fakeFetch = (async (requestInput: URL | string) => {
      const requestPath = new URL(String(requestInput)).pathname;
      requestLog.push(requestPath);
      if (requestPath.endsWith('createSession')) return new Response(JSON.stringify({ accessJwt: `jwt${requestLog.length}` }), { status: 200 });
      feedCallCount += 1;
      return feedCallCount === 1 ? new Response('{}', { status: 401 }) : new Response(JSON.stringify({ posts: [], cursor: '' }), { status: 200 });
    }) as typeof fetch;
    const blueskyClient = createBlueskyClient({
      blueskyConfig: SIGNED_IN_CONFIG, tokenBucket: { take: async () => undefined }, logger: pino({ level: 'silent' }), fetchImpl: fakeFetch,
    });
    expect(await blueskyClient.fetchNewPage('#art', undefined)).toEqual({ postList: [], nextCursor: undefined });
    expect(requestLog).toEqual([
      '/xrpc/com.atproto.server.createSession', '/xrpc/app.bsky.feed.searchPosts',
      '/xrpc/com.atproto.server.createSession', '/xrpc/app.bsky.feed.searchPosts',
    ]);
  });
});
