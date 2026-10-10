// Reads Bluesky through the AppView XRPC API. "#tag" targets use searchPosts (newest first);
// "@handle" targets use getAuthorFeed with posts_with_media. Optional app-password session.
import type { Logger } from 'pino';
import { fetchWithRetry, PlatformRequestError } from '../fetchWithRetry.js';
import type { TokenBucketInstance } from '../rateLimit.js';
import type { PlatformPageDetails } from '../types.js';
import type { BlueskyConfigDetails } from './blueskyConfig.js';
import { parseAuthorFeedPage, parseSearchPage } from './feed.js';

const PAGE_SIZE = 100;

export interface BlueskyClientDependencies {
  blueskyConfig: BlueskyConfigDetails;
  tokenBucket: TokenBucketInstance;
  logger: Logger;
  onRequest?: (statusCode: number) => void;
  fetchImpl?: typeof fetch;
  sleepMs?: (delayMs: number) => Promise<void>;
}

export interface BlueskyClientInstance {
  fetchNewPage(targetName: string, pageCursor: string | undefined): Promise<PlatformPageDetails>;
}

export function buildRequestUrl(blueskyConfig: BlueskyConfigDetails, targetName: string, pageCursor: string | undefined, isSignedIn: boolean): URL {
  const isHashtag = targetName.startsWith('#');
  const baseUrl = isSignedIn ? blueskyConfig.pdsUrl : isHashtag ? blueskyConfig.searchApiBaseUrl : blueskyConfig.apiBaseUrl;
  const requestUrl = new URL(isHashtag ? '/xrpc/app.bsky.feed.searchPosts' : '/xrpc/app.bsky.feed.getAuthorFeed', baseUrl);
  if (isHashtag) {
    requestUrl.searchParams.set('q', targetName);
    requestUrl.searchParams.set('sort', 'latest');
  } else {
    requestUrl.searchParams.set('actor', targetName.slice(1));
    requestUrl.searchParams.set('filter', 'posts_with_media');
  }
  requestUrl.searchParams.set('limit', String(PAGE_SIZE));
  if (pageCursor) requestUrl.searchParams.set('cursor', pageCursor);
  return requestUrl;
}

export function createBlueskyClient(clientDependencies: BlueskyClientDependencies): BlueskyClientInstance {
  const { blueskyConfig, tokenBucket, logger } = clientDependencies;
  const fetchImpl = clientDependencies.fetchImpl ?? fetch;
  const isSignedIn = Boolean(blueskyConfig.identifier && blueskyConfig.appPassword);
  let accessJwt: string | undefined;

  async function createSession(): Promise<string> {
    await tokenBucket.take();
    const sessionResponse = await fetchImpl(new URL('/xrpc/com.atproto.server.createSession', blueskyConfig.pdsUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': blueskyConfig.userAgent },
      body: JSON.stringify({ identifier: blueskyConfig.identifier, password: blueskyConfig.appPassword }),
    });
    if (!sessionResponse.ok) throw new PlatformRequestError(sessionResponse.status, 'Bluesky sign-in failed');
    logger.info('Bluesky session created');
    return ((await sessionResponse.json()) as { accessJwt: string }).accessJwt;
  }

  async function requestPage(requestUrl: URL): Promise<Response> {
    if (isSignedIn && !accessJwt) accessJwt = await createSession();
    return fetchWithRetry(() => fetchImpl(requestUrl, {
      headers: { 'User-Agent': blueskyConfig.userAgent, ...(accessJwt ? { Authorization: `Bearer ${accessJwt}` } : {}) },
    }), { tokenBucket, logger, requestLabel: `bluesky ${requestUrl.pathname}`, onResponse: clientDependencies.onRequest, sleepMs: clientDependencies.sleepMs });
  }

  return {
    async fetchNewPage(targetName, pageCursor) {
      const requestUrl = buildRequestUrl(blueskyConfig, targetName, pageCursor, isSignedIn);
      let pageResponse: Response;
      try {
        pageResponse = await requestPage(requestUrl);
      } catch (error) {
        // Access tokens expire after a couple of hours: sign in again once and retry
        if (!(isSignedIn && error instanceof PlatformRequestError && error.statusCode === 401)) throw error;
        accessJwt = undefined;
        pageResponse = await requestPage(requestUrl);
      }
      const pageJson = await pageResponse.json();
      return targetName.startsWith('#')
        ? parseSearchPage(pageJson, blueskyConfig.includeAdultContent)
        : parseAuthorFeedPage(pageJson, blueskyConfig.includeAdultContent);
    },
  };
}
