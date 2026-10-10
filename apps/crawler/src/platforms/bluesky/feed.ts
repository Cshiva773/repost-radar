// Maps Bluesky AppView responses (searchPosts, getAuthorFeed) to platform-neutral posts. Pure.
import type { PlatformMediaDetails, PlatformPageDetails, PlatformPostDetails } from '../types.js';

export interface BlueskyImageView {
  fullsize?: string;
}

export interface BlueskyEmbedView {
  $type?: string;
  images?: BlueskyImageView[];
  media?: BlueskyEmbedView;
}

export interface BlueskyPostView {
  uri: string;
  author?: { did?: string; handle?: string };
  record?: { createdAt?: string; text?: string; labels?: { values?: { val?: string }[] } };
  embed?: BlueskyEmbedView;
  indexedAt?: string;
  labels?: { val?: string }[];
}

const IMAGES_VIEW_TYPE = 'app.bsky.embed.images#view';
const RECORD_WITH_MEDIA_VIEW_TYPE = 'app.bsky.embed.recordWithMedia#view';
const ADULT_LABEL_SET = new Set(['porn', 'sexual', 'nudity', 'graphic-media']);
const TITLE_MAX_LENGTH = 200;

/** at://did:plc:abc/app.bsky.feed.post/3kxyz -> { did, recordKey } */
export function parsePostUri(postUri: string): { did: string; recordKey: string } | undefined {
  const uriMatch = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(postUri);
  return uriMatch ? { did: uriMatch[1]!, recordKey: uriMatch[2]! } : undefined;
}

export function isAdultLabelled(postView: BlueskyPostView): boolean {
  const labelValueList = [
    ...(postView.labels ?? []).map((label) => label.val),
    ...(postView.record?.labels?.values ?? []).map((label) => label.val),
  ];
  return labelValueList.some((labelValue) => labelValue !== undefined && ADULT_LABEL_SET.has(labelValue));
}

function imageViews(embedView: BlueskyEmbedView | undefined): BlueskyImageView[] {
  if (embedView?.$type === IMAGES_VIEW_TYPE) return embedView.images ?? [];
  if (embedView?.$type === RECORD_WITH_MEDIA_VIEW_TYPE) return imageViews(embedView.media);
  return [];
}

export function extractMedia(postView: BlueskyPostView, includeAdultContent: boolean): PlatformMediaDetails[] {
  const postReference = parsePostUri(postView.uri);
  if (!postReference || (!includeAdultContent && isAdultLabelled(postView))) return [];
  return imageViews(postView.embed).flatMap((imageView, imageIndex) =>
    imageView.fullsize ? [{ platformPostId: `${postReference.did}/${postReference.recordKey}:${imageIndex}`, imageUrl: imageView.fullsize }] : []);
}

export function toPlatformPost(postView: BlueskyPostView, includeAdultContent: boolean): PlatformPostDetails {
  const postReference = parsePostUri(postView.uri);
  const profileSegment = postView.author?.handle ?? postReference?.did ?? 'unknown';
  // indexedAt is set by the AppView; createdAt comes from the client and can be backdated
  const postedAt = new Date(postView.indexedAt ?? postView.record?.createdAt ?? 0);
  return {
    sourcePostId: postView.uri,
    postedAt,
    author: postView.author?.handle,
    title: postView.record?.text?.slice(0, TITLE_MAX_LENGTH),
    permalinkUrl: `https://bsky.app/profile/${profileSegment}/post/${postReference?.recordKey ?? ''}`,
    mediaList: extractMedia(postView, includeAdultContent),
  };
}

export function parseSearchPage(searchJson: unknown, includeAdultContent: boolean): PlatformPageDetails {
  const searchBody = searchJson as { posts?: BlueskyPostView[]; cursor?: string };
  return {
    postList: (searchBody.posts ?? []).map((postView) => toPlatformPost(postView, includeAdultContent)),
    nextCursor: searchBody.cursor || undefined,
  };
}

// Skips reposts (items with a `reason`): the account boosting someone else's post is not posting it
export function parseAuthorFeedPage(feedJson: unknown, includeAdultContent: boolean): PlatformPageDetails {
  const feedBody = feedJson as { feed?: { post: BlueskyPostView; reason?: unknown }[]; cursor?: string };
  return {
    postList: (feedBody.feed ?? []).filter((feedItem) => !feedItem.reason).map((feedItem) => toPlatformPost(feedItem.post, includeAdultContent)),
    nextCursor: feedBody.cursor || undefined,
  };
}
