// Reads /api/info for a batch of post fullnames (t3_...). A post counts as gone when Reddit no longer
// returns it, when it was removed by moderators or Reddit, or when its author deleted it.
export const REDDIT_EXISTENCE_BATCH_SIZE = 100;

interface InfoChildData {
  name?: string;
  author?: string;
  removed_by_category?: string | null;
}

export function parseRedditPostExistence(infoJson: unknown, requestedIdList: string[]): Map<string, boolean> {
  const childList = ((infoJson as { data?: { children?: { data?: InfoChildData }[] } })?.data?.children ?? []);
  const childByName = new Map(childList.flatMap((child) => (child.data?.name ? [[child.data.name, child.data] as const] : [])));
  return new Map(requestedIdList.map((postId) => {
    const childData = childByName.get(postId);
    const isGone = !childData || Boolean(childData.removed_by_category) || childData.author === '[deleted]';
    return [postId, !isGone];
  }));
}
