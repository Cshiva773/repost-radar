// Parses Reddit listing JSON (`/r/<sub>/new`) into platform-neutral posts. Pure; no network.
import type { PlatformMediaDetails, PlatformPageDetails, PlatformPostDetails } from '../types.js';

export interface RedditPostData {
  id: string;
  name: string;
  author?: string;
  title?: string;
  permalink?: string;
  url?: string;
  created_utc: number;
  post_hint?: string;
  is_video?: boolean;
  is_self?: boolean;
  is_gallery?: boolean;
  gallery_data?: { items?: { media_id: string }[] };
  media_metadata?: Record<string, { status?: string; e?: string; s?: { u?: string } }>;
  subreddit?: string;
  crosspost_parent_list?: { subreddit?: string }[];
}

const REDDIT_BASE_URL = 'https://www.reddit.com';
const DIRECT_IMAGE_PATTERN = /\.(jpe?g|png|webp)(\?.*)?$/i;

function decodeHtmlEntities(rawUrl: string): string {
  return rawUrl.replace(/&amp;/g, '&');
}

function galleryMedia(postData: RedditPostData): PlatformMediaDetails[] {
  const mediaIdList = postData.gallery_data?.items?.map((item) => item.media_id) ?? [];
  return mediaIdList.flatMap((mediaId) => {
    const mediaDetails = postData.media_metadata?.[mediaId];
    const sourceUrl = mediaDetails?.s?.u;
    if (mediaDetails?.status !== 'valid' || mediaDetails.e !== 'Image' || !sourceUrl) return [];
    return [{ platformPostId: `${postData.id}:${mediaId}`, imageUrl: decodeHtmlEntities(sourceUrl) }];
  });
}

export function extractMedia(postData: RedditPostData): PlatformMediaDetails[] {
  if (postData.is_video || postData.is_self) return [];
  if (postData.is_gallery) return galleryMedia(postData);
  const directUrl = postData.url ? decodeHtmlEntities(postData.url) : undefined;
  const isImagePost = postData.post_hint === 'image' || (directUrl !== undefined && DIRECT_IMAGE_PATTERN.test(directUrl));
  return isImagePost && directUrl ? [{ platformPostId: postData.id, imageUrl: directUrl }] : [];
}

// A crosspost names the subreddit the original was posted in: a place where the same image circulates
export function crosspostSubreddits(postData: RedditPostData): string[] {
  const ownSubreddit = postData.subreddit?.toLowerCase();
  const parentSubredditList = (postData.crosspost_parent_list ?? []).flatMap((parentPost) => (parentPost.subreddit ? [parentPost.subreddit] : []));
  return [...new Set(parentSubredditList.filter((subreddit) => subreddit.toLowerCase() !== ownSubreddit))];
}

export function toPlatformPost(postData: RedditPostData): PlatformPostDetails {
  return {
    sourcePostId: postData.name,
    postedAt: new Date(postData.created_utc * 1000),
    author: postData.author,
    title: postData.title,
    permalinkUrl: `${REDDIT_BASE_URL}${postData.permalink ?? `/comments/${postData.id}`}`,
    mediaList: extractMedia(postData),
    relatedTargetList: crosspostSubreddits(postData),
  };
}

export function parseListingPage(listingJson: unknown): PlatformPageDetails {
  const listingData = (listingJson as { data?: { children?: { data: RedditPostData }[]; after?: string | null } }).data;
  return {
    postList: (listingData?.children ?? []).map((child) => toPlatformPost(child.data)),
    nextCursor: listingData?.after ?? undefined,
  };
}
