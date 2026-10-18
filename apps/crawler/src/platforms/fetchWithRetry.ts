// Shared request loop for platform clients: spend a rate-limit token per attempt, retry 429/5xx
// with full-jitter backoff (or the server's Retry-After), and surface other failures as errors.
import type { Logger } from 'pino';
import { computeBackoffMs, type TokenBucketInstance } from './rateLimit.js';

const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 300_000;

export class PlatformRequestError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

export interface RetryOptions {
  tokenBucket: TokenBucketInstance;
  logger: Logger;
  requestLabel: string;
  onResponse?: (statusCode: number) => void;
  sleepMs?: (delayMs: number) => Promise<void>;
}

const defaultSleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export function isRetryableStatus(statusCode: number): boolean {
  return statusCode === 429 || statusCode >= 500;
}

// Retry-After may be seconds or an HTTP date; fall back to jittered backoff when absent or unparseable
export function retryDelayMs(retryAfterHeader: string | null, attemptNumber: number, nowMs: number = Date.now()): number {
  if (retryAfterHeader) {
    const retryAfterSeconds = Number(retryAfterHeader);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) return Math.min(BACKOFF_MAX_MS, retryAfterSeconds * 1000);
    const retryAtMs = Date.parse(retryAfterHeader);
    if (Number.isFinite(retryAtMs)) return Math.min(BACKOFF_MAX_MS, Math.max(0, retryAtMs - nowMs));
  }
  return computeBackoffMs(attemptNumber, BACKOFF_BASE_MS, BACKOFF_MAX_MS);
}

const ERROR_EXCERPT_LENGTH = 200;

export async function fetchWithRetry(performRequest: () => Promise<Response>, retryOptions: RetryOptions): Promise<Response> {
  const sleepMs = retryOptions.sleepMs ?? defaultSleep;
  for (let attemptNumber = 0; attemptNumber < MAX_ATTEMPTS; attemptNumber += 1) {
    await retryOptions.tokenBucket.take();
    const platformResponse = await performRequest();
    retryOptions.onResponse?.(platformResponse.status);
    if (platformResponse.ok) return platformResponse;
    if (!isRetryableStatus(platformResponse.status)) {
      // The platform's own explanation (e.g. "search requires authentication") is what makes a 4xx actionable
      const errorExcerpt = (await platformResponse.text().catch(() => '')).slice(0, ERROR_EXCERPT_LENGTH).trim();
      throw new PlatformRequestError(platformResponse.status, `${retryOptions.requestLabel} failed with HTTP ${platformResponse.status}${errorExcerpt ? `: ${errorExcerpt}` : ''}`);
    }
    const delayMs = retryDelayMs(platformResponse.headers.get('retry-after'), attemptNumber);
    retryOptions.logger.warn({ requestLabel: retryOptions.requestLabel, statusCode: platformResponse.status, attemptNumber, delayMs }, 'Request throttled, backing off');
    await sleepMs(delayMs);
  }
  throw new PlatformRequestError(429, `${retryOptions.requestLabel} failed after ${MAX_ATTEMPTS} attempts`);
}
