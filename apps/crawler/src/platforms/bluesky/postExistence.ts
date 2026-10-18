// app.bsky.feed.getPosts returns only posts that still exist and are visible; a requested at:// URI
// missing from the answer was deleted (or its account was taken down or deactivated).
export const BLUESKY_EXISTENCE_BATCH_SIZE = 25;

export function parseBlueskyPostExistence(getPostsJson: unknown, requestedUriList: string[]): Map<string, boolean> {
  const postList = (getPostsJson as { posts?: { uri?: string }[] })?.posts ?? [];
  const presentUriSet = new Set(postList.flatMap((postView) => (postView.uri ? [postView.uri] : [])));
  return new Map(requestedUriList.map((postUri) => [postUri, presentUriSet.has(postUri)]));
}
