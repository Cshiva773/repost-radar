export const DEFAULT_SIGNED_IN_PATH = '/queue/pending';

// Where to go after signing in: the page the reviewer was sent away from, if it is an in-app path.
// Anything else (missing, the sign-in page itself, "//other.site" or a full URL) falls back to the queue,
// so a crafted link can never bounce a fresh session to another site.
export function resolveReturnPath(locationState: unknown): string {
  const returnTo = (locationState as { returnTo?: unknown } | null)?.returnTo;
  if (typeof returnTo !== 'string' || !/^\/(?![/\\])/.test(returnTo)) return DEFAULT_SIGNED_IN_PATH;
  return returnTo === '/login' || returnTo.startsWith('/login?') ? DEFAULT_SIGNED_IN_PATH : returnTo;
}
