// Parses Reddit listing JSON (`/r/<sub>/new`) into image posts. Pure; no network.

export interface ImagePostDetails {
  platformPostId: string;
  redditPostId: string;
  author: string | undefined;
  title: string | undefined;
  permalinkUrl: string;
  imageUrl: string;
  postedAt: Date;
}

export interface ListingPageDetails {
  postList: RedditPostData[];
  afterCursor: string | undefined;
}

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
}

const REDDIT_BASE_URL = 'https://www.reddit.com';
const DIRECT_IMAGE_PATTERN = /\.(jpe?g|png|webp)(\?.*)?$/i;

function decodeHtmlEntities(rawUrl: string): string {
  return rawUrl.replace(/&amp;/g, '&');
}

export function parseListingPage(listingJson: unknown): ListingPageDetails {
  const listingData = (listingJson as { data?: { children?: { data: RedditPostData }[]; after?: string | null } }).data;
  return {
    postList: (listingData?.children ?? []).map((child) => child.data),
    afterCursor: listingData?.after ?? undefined,
  };
}

function galleryImageUrls(postData: RedditPostData): { mediaId: string; imageUrl: string }[] {
  const mediaIdList = postData.gallery_data?.items?.map((item) => item.media_id) ?? [];
  return mediaIdList.flatMap((mediaId) => {
    const mediaDetails = postData.media_metadata?.[mediaId];
    const sourceUrl = mediaDetails?.s?.u;
    if (mediaDetails?.status !== 'valid' || mediaDetails.e !== 'Image' || !sourceUrl) return [];
    return [{ mediaId, imageUrl: decodeHtmlEntities(sourceUrl) }];
  });
}

export function extractImagePosts(postData: RedditPostData): ImagePostDetails[] {
  if (postData.is_video || postData.is_self) return [];
  const sharedDetails = {
    redditPostId: postData.name,
    author: postData.author,
    title: postData.title,
    permalinkUrl: `${REDDIT_BASE_URL}${postData.permalink ?? `/comments/${postData.id}`}`,
    postedAt: new Date(postData.created_utc * 1000),
  };
  if (postData.is_gallery) {
    return galleryImageUrls(postData).map(({ mediaId, imageUrl }) => ({
      ...sharedDetails, platformPostId: `${postData.id}:${mediaId}`, imageUrl,
    }));
  }
  const directUrl = postData.url ? decodeHtmlEntities(postData.url) : undefined;
  const isImagePost = postData.post_hint === 'image' || (directUrl !== undefined && DIRECT_IMAGE_PATTERN.test(directUrl));
  return isImagePost && directUrl ? [{ ...sharedDetails, platformPostId: postData.id, imageUrl: directUrl }] : [];
}
