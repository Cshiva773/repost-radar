// Bluesky adapter settings (BLUESKY_* environment variables).
//
// Without credentials it reads the public AppView: account feeds from public.api.bsky.app and
// hashtag search from api.bsky.app (public.api.bsky.app returns 403 for searchPosts). With an app
// password it signs in to the PDS and sends both through it, which does not rely on that quirk.

export interface BlueskyConfigDetails {
  apiBaseUrl: string;
  searchApiBaseUrl: string;
  pdsUrl: string;
  identifier: string | undefined;
  appPassword: string | undefined;
  userAgent: string;
  requestsPerMinute: number;
  includeAdultContent: boolean;
}

const DEFAULT_REQUESTS_PER_MINUTE = 25;

function readPositiveInteger(rawValue: string | undefined, fallbackValue: number): number {
  const parsedValue = Number(rawValue ?? fallbackValue);
  return Number.isFinite(parsedValue) && parsedValue >= 1 ? Math.floor(parsedValue) : fallbackValue;
}

export function loadBlueskyConfig(environmentDetails: NodeJS.ProcessEnv): BlueskyConfigDetails {
  const blueskyConfig: BlueskyConfigDetails = {
    apiBaseUrl: environmentDetails.BLUESKY_API_BASE ?? 'https://public.api.bsky.app',
    searchApiBaseUrl: environmentDetails.BLUESKY_SEARCH_API_BASE ?? 'https://api.bsky.app',
    pdsUrl: environmentDetails.BLUESKY_PDS_URL ?? 'https://bsky.social',
    identifier: environmentDetails.BLUESKY_IDENTIFIER || undefined,
    appPassword: environmentDetails.BLUESKY_APP_PASSWORD || undefined,
    userAgent: environmentDetails.BLUESKY_USER_AGENT ?? 'repost-radar/0.1',
    requestsPerMinute: readPositiveInteger(environmentDetails.BLUESKY_REQUESTS_PER_MINUTE, DEFAULT_REQUESTS_PER_MINUTE),
    // Off by default: images from posts labelled porn/sexual/nudity/graphic-media are not downloaded
    includeAdultContent: environmentDetails.BLUESKY_INCLUDE_ADULT_CONTENT === 'true',
  };
  if (Boolean(blueskyConfig.identifier) !== Boolean(blueskyConfig.appPassword)) {
    throw new Error('Set both BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD, or neither');
  }
  return blueskyConfig;
}
