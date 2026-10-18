import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { fetchWithRetry, PlatformRequestError, retryDelayMs } from './fetchWithRetry.js';

const RETRY_OPTIONS = {
  tokenBucket: { take: async () => undefined },
  logger: pino({ level: 'silent' }),
  requestLabel: 'test request',
  sleepMs: async () => undefined,
};

function respondWith(statusList: number[]) {
  const seenStatusList: number[] = [];
  let callIndex = 0;
  const performRequest = async () => new Response('{}', { status: statusList[Math.min(callIndex++, statusList.length - 1)] });
  return { performRequest, options: { ...RETRY_OPTIONS, onResponse: (statusCode: number) => seenStatusList.push(statusCode) }, seenStatusList };
}

describe('fetchWithRetry', () => {
  it('retries 429 and 5xx until a success', async () => {
    const { performRequest, options, seenStatusList } = respondWith([429, 503, 200]);
    expect((await fetchWithRetry(performRequest, options)).status).toBe(200);
    expect(seenStatusList).toEqual([429, 503, 200]);
  });

  it('fails fast on a non-retryable status', async () => {
    const { performRequest, options } = respondWith([403]);
    await expect(fetchWithRetry(performRequest, options)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('gives up after five throttled attempts', async () => {
    const { performRequest, options, seenStatusList } = respondWith([429]);
    await expect(fetchWithRetry(performRequest, options)).rejects.toBeInstanceOf(PlatformRequestError);
    expect(seenStatusList).toHaveLength(5);
  });
});

describe('retryDelayMs', () => {
  it('honours Retry-After in seconds or as a date, capped at 5 minutes', () => {
    expect(retryDelayMs('7', 0)).toBe(7000);
    expect(retryDelayMs('99999', 0)).toBe(300_000);
    expect(retryDelayMs(new Date(10_000).toUTCString(), 0, 4_000)).toBe(6000);
  });

  it('falls back to jittered backoff without a usable header', () => {
    const delayMs = retryDelayMs(null, 2);
    expect(delayMs).toBeGreaterThanOrEqual(0);
    expect(delayMs).toBeLessThanOrEqual(8000);
  });
});
