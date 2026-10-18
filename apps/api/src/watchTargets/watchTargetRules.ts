// Validation for watch targets, kept pure so it is unit-testable. Platform-specific rules (what a
// valid target looks like, the request budget) come from the shared @repost-radar/platforms registry.
import { DEFAULT_PLATFORM_NAME, findPlatformDefinition, type PlatformDefinition } from '@repost-radar/platforms';

export const MIN_POLL_INTERVAL_SECONDS = 60;
export const DEFAULT_POLL_INTERVAL_SECONDS = 300;

export type ResolveTargetResult =
  | { isError: false; platformDefinition: PlatformDefinition; targetName: string }
  | { isError: true; message: string };

/**
 * Accepts `{ platform, target }`, and the original Reddit-only `{ subreddit }` body for
 * compatibility. The platform must exist and be enabled on this deployment.
 */
export function resolveWatchTarget(requestBody: { platform?: unknown; target?: unknown; subreddit?: unknown }, enabledPlatformList: string[]): ResolveTargetResult {
  const platformDefinition = findPlatformDefinition(requestBody.platform ?? DEFAULT_PLATFORM_NAME);
  if (!platformDefinition || !enabledPlatformList.includes(platformDefinition.platformName)) {
    return { isError: true, message: `platform must be one of: ${enabledPlatformList.join(', ')}` };
  }
  const targetName = platformDefinition.normaliseTarget(requestBody.target ?? requestBody.subreddit);
  if (!targetName) {
    return { isError: true, message: `target must be a valid ${platformDefinition.displayName} ${platformDefinition.targetLabel}, e.g. "${platformDefinition.targetExample}"` };
  }
  return { isError: false, platformDefinition, targetName };
}

export function parsePollInterval(rawInterval: unknown): number | undefined {
  if (rawInterval === undefined) return DEFAULT_POLL_INTERVAL_SECONDS;
  const parsedInterval = Number(rawInterval);
  return Number.isInteger(parsedInterval) && parsedInterval >= MIN_POLL_INTERVAL_SECONDS ? parsedInterval : undefined;
}

// Each poll costs at least one listing request
export function requestsPerMinuteFor(pollIntervalSecondsList: number[]): number {
  return pollIntervalSecondsList.reduce((totalRate, pollIntervalSeconds) => totalRate + 60 / pollIntervalSeconds, 0);
}

// Budgets are per platform: polling Reddit harder does not eat into another platform's allowance
export function exceedsRequestBudget(platformDefinition: PlatformDefinition, pollIntervalSecondsList: number[]): boolean {
  return requestsPerMinuteFor(pollIntervalSecondsList) > platformDefinition.maxRequestsPerMinute;
}
