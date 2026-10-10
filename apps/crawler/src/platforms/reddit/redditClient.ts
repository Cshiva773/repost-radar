// Fetches `/r/<sub>/new` pages. Live mode uses Reddit's app-only OAuth (client credentials);
// fixture mode talks to the local fake-reddit service with the same response shape.
import type { Logger } from 'pino';
import { fetchWithRetry, PlatformRequestError } from '../fetchWithRetry.js';
import type { TokenBucketInstance } from '../rateLimit.js';
import type { PlatformPageDetails } from '../types.js';
import { parseListingPage } from './listing.js';
import type { RedditConfigDetails } from './redditConfig.js';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const PAGE_SIZE = 100;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export interface RedditClientInstance {
  fetchNewPage(subreddit: string, afterCursor: string | undefined): Promise<PlatformPageDetails>;
}

export interface RedditClientDependencies {
  redditConfig: RedditConfigDetails;
  tokenBucket: TokenBucketInstance;
  logger: Logger;
  onRequest?: (statusCode: number) => void;
  fetchImpl?: typeof fetch;
  sleepMs?: (delayMs: number) => Promise<void>;
}


export function createRedditClient(clientDependencies: RedditClientDependencies): RedditClientInstance {
  const { redditConfig, tokenBucket, logger } = clientDependencies;
  const fetchImpl = clientDependencies.fetchImpl ?? fetch;
  let cachedToken: { accessToken: string; expiresAtMs: number } | undefined;

  async function readAccessToken(): Promise<string | undefined> {
    if (redditConfig.mode !== 'live') return undefined;
    if (cachedToken && cachedToken.expiresAtMs - TOKEN_REFRESH_MARGIN_MS > Date.now()) return cachedToken.accessToken;
    const basicAuth = Buffer.from(`${redditConfig.clientId}:${redditConfig.clientSecret}`).toString('base64');
    await tokenBucket.take();
    const tokenResponse = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basicAuth}`, 'User-Agent': redditConfig.userAgent, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!tokenResponse.ok) throw new PlatformRequestError(tokenResponse.status, 'Reddit token request failed');
    const tokenBody = (await tokenResponse.json()) as { access_token: string; expires_in: number };
    cachedToken = { accessToken: tokenBody.access_token, expiresAtMs: Date.now() + tokenBody.expires_in * 1000 };
    logger.info({ expiresInSeconds: tokenBody.expires_in }, 'Reddit access token refreshed');
    return cachedToken.accessToken;
  }

  function buildListingUrl(subreddit: string, afterCursor: string | undefined): string {
    const listingPath = redditConfig.mode === 'live' ? `/r/${encodeURIComponent(subreddit)}/new` : `/r/${encodeURIComponent(subreddit)}/new.json`;
    const listingUrl = new URL(listingPath, redditConfig.apiBaseUrl);
    listingUrl.searchParams.set('limit', String(PAGE_SIZE));
    listingUrl.searchParams.set('raw_json', '1');
    if (afterCursor) listingUrl.searchParams.set('after', afterCursor);
    return listingUrl.toString();
  }

  return {
    async fetchNewPage(subreddit, afterCursor) {
      const listingUrl = buildListingUrl(subreddit, afterCursor);
      const accessToken = await readAccessToken();
      const listingResponse = await fetchWithRetry(() => fetchImpl(listingUrl, {
        headers: { 'User-Agent': redditConfig.userAgent, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      }), {
        tokenBucket, logger, requestLabel: `reddit listing r/${subreddit}`, onResponse: clientDependencies.onRequest, sleepMs: clientDependencies.sleepMs,
      });
      logger.debug({ rateLimitRemaining: listingResponse.headers.get('x-ratelimit-remaining') }, 'Reddit listing request');
      return parseListingPage(await listingResponse.json());
    },
  };
}
