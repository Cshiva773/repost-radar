// One global request budget shared by every watch target (docs/PRD.md: <= 60 req/min to Reddit).

export interface TokenBucketOptions {
  requestsPerMinute: number;
  nowMs?: () => number;
  sleepMs?: (delayMs: number) => Promise<void>;
}

export interface TokenBucketInstance {
  take(): Promise<void>;
}

const MS_PER_MINUTE = 60_000;

const defaultSleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export function createTokenBucket(bucketOptions: TokenBucketOptions): TokenBucketInstance {
  const nowMs = bucketOptions.nowMs ?? Date.now;
  const sleepMs = bucketOptions.sleepMs ?? defaultSleep;
  const capacity = bucketOptions.requestsPerMinute;
  const refillPerMs = capacity / MS_PER_MINUTE;
  let availableTokens = capacity;
  let lastRefillMs = nowMs();

  const refill = () => {
    const currentMs = nowMs();
    availableTokens = Math.min(capacity, availableTokens + (currentMs - lastRefillMs) * refillPerMs);
    lastRefillMs = currentMs;
  };

  return {
    async take() {
      refill();
      while (availableTokens < 1) {
        await sleepMs(Math.ceil((1 - availableTokens) / refillPerMs));
        refill();
      }
      availableTokens -= 1;
    },
  };
}

// Exponential backoff with full jitter: random delay in [0, min(maxMs, baseMs * 2^attempt)]
export function computeBackoffMs(attemptNumber: number, baseMs: number, maxMs: number, randomValue: number = Math.random()): number {
  const ceilingMs = Math.min(maxMs, baseMs * 2 ** attemptNumber);
  return Math.floor(randomValue * ceilingMs);
}
