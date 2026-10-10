// Fetches `/r/<sub>/new` pages. Live mode uses Reddit's app-only OAuth (client credentials);
// fixture mode talks to the local fake-reddit service with the same response shape.
import type { Logger } from 'pino';
import type { RedditConfigDetails } from '../config.js';
import { parseListingPage, type ListingPageDetails } from './listing.js';
import { computeBackoffMs, type TokenBucketInstance } from './rateLimit.js';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const PAGE_SIZE = 100;
const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 300_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export interface RedditClientInstance {
  fetchNewPage(subreddit: string, afterCursor: string | undefined): Promise<ListingPageDetails>;
}

export interface RedditClientDependencies {
  redditConfig: RedditConfigDetails;
  tokenBucket: TokenBucketInstance;
  logger: Logger;
  onRequest?: (statusCode: number) => void;
  fetchImpl?: typeof fetch;
  sleepMs?: (delayMs: number) => Promise<void>;
}

export class RedditRequestError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

const defaultSleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

function isRetryable(statusCode: number): boolean {
  return statusCode === 429 || statusCode >= 500;
}

export function createRedditClient(clientDependencies: RedditClientDependencies): RedditClientInstance {
  const { redditConfig, tokenBucket, logger } = clientDependencies;
  const fetchImpl = clientDependencies.fetchImpl ?? fetch;
  const sleepMs = clientDependencies.sleepMs ?? defaultSleep;
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
    if (!tokenResponse.ok) throw new RedditRequestError(tokenResponse.status, 'Reddit token request failed');
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

  async function requestOnce(listingUrl: string): Promise<Response> {
    const accessToken = await readAccessToken();
    await tokenBucket.take();
    const listingResponse = await fetchImpl(listingUrl, {
      headers: { 'User-Agent': redditConfig.userAgent, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    });
    clientDependencies.onRequest?.(listingResponse.status);
    logger.debug({
      statusCode: listingResponse.status,
      rateLimitRemaining: listingResponse.headers.get('x-ratelimit-remaining'),
      rateLimitResetSeconds: listingResponse.headers.get('x-ratelimit-reset'),
    }, 'Reddit listing request');
    return listingResponse;
  }

  return {
    async fetchNewPage(subreddit, afterCursor) {
      const listingUrl = buildListingUrl(subreddit, afterCursor);
      for (let attemptNumber = 0; attemptNumber < MAX_ATTEMPTS; attemptNumber += 1) {
        const listingResponse = await requestOnce(listingUrl);
        if (listingResponse.ok) return parseListingPage(await listingResponse.json());
        if (!isRetryable(listingResponse.status)) throw new RedditRequestError(listingResponse.status, `listing ${subreddit} failed`);
        const backoffMs = computeBackoffMs(attemptNumber, BACKOFF_BASE_MS, BACKOFF_MAX_MS);
        logger.warn({ subreddit, statusCode: listingResponse.status, attemptNumber, backoffMs }, 'Reddit request throttled, backing off');
        await sleepMs(backoffMs);
      }
      throw new RedditRequestError(429, `listing ${subreddit} failed after ${MAX_ATTEMPTS} attempts`);
    },
  };
}
