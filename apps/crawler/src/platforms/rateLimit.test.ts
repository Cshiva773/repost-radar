import { describe, expect, it } from 'vitest';
import { computeBackoffMs, createTokenBucket } from './rateLimit.js';

function buildFakeClock() {
  let currentMs = 0;
  const sleptDelayList: number[] = [];
  return {
    nowMs: () => currentMs,
    sleepMs: async (delayMs: number) => { sleptDelayList.push(delayMs); currentMs += delayMs; },
    advance: (deltaMs: number) => { currentMs += deltaMs; },
    sleptDelayList,
  };
}

describe('createTokenBucket', () => {
  it('lets a full minute of requests through without waiting', async () => {
    const fakeClock = buildFakeClock();
    const tokenBucket = createTokenBucket({ requestsPerMinute: 60, ...fakeClock });
    for (let requestIndex = 0; requestIndex < 60; requestIndex += 1) await tokenBucket.take();
    expect(fakeClock.sleptDelayList).toEqual([]);
  });

  it('waits for a refill once the bucket is empty', async () => {
    const fakeClock = buildFakeClock();
    const tokenBucket = createTokenBucket({ requestsPerMinute: 60, ...fakeClock });
    for (let requestIndex = 0; requestIndex < 61; requestIndex += 1) await tokenBucket.take();
    expect(fakeClock.sleptDelayList).toEqual([1000]);
  });

  it('refills over time while idle', async () => {
    const fakeClock = buildFakeClock();
    const tokenBucket = createTokenBucket({ requestsPerMinute: 2, ...fakeClock });
    await tokenBucket.take();
    await tokenBucket.take();
    fakeClock.advance(30_000);
    await tokenBucket.take();
    expect(fakeClock.sleptDelayList).toEqual([]);
  });
});

describe('computeBackoffMs', () => {
  it('doubles the ceiling per attempt and caps it', () => {
    expect(computeBackoffMs(0, 1000, 300_000, 0.999)).toBe(999);
    expect(computeBackoffMs(3, 1000, 300_000, 0.5)).toBe(4000);
    expect(computeBackoffMs(20, 1000, 300_000, 0.5)).toBe(150_000);
  });
});
