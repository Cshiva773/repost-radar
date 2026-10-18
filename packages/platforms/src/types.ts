// What every platform must declare so the API can validate watch targets and the crawler can
// budget requests. Network code lives in the crawler's adapters, not here: this package stays
// pure so both services can depend on it.

export interface PlatformDefinition {
  /** Stored in watch_targets.platform and crawled_posts.platform, e.g. "reddit" */
  platformName: string;
  displayName: string;
  /** What a watch target is on this platform, e.g. "subreddit", "hashtag", "account" */
  targetLabel: string;
  targetExample: string;
  /** Combined listing requests per minute allowed across all of a creator's targets */
  maxRequestsPerMinute: number;
  /** Returns the canonical target name, or undefined when it is not valid on this platform */
  normaliseTarget(rawTarget: unknown): string | undefined;
  /** Public URL of a target, shown in the UI */
  targetUrl(targetName: string): string;
}
