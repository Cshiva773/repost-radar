import { describe, expect, it } from 'vitest';
import { extractMedia, parseListingPage, toPlatformPost, type RedditPostData } from './listing.js';

const BASE_POST: RedditPostData = {
  id: 'abc', name: 't3_abc', author: 'someone', title: 'A photo', permalink: '/r/pics/comments/abc/a_photo/', created_utc: 1_790_000_000,
};

describe('extractMedia', () => {
  it('keeps a direct image post', () => {
    expect(extractMedia({ ...BASE_POST, post_hint: 'image', url: 'https://i.redd.it/abc.jpg' }))
      .toEqual([{ platformPostId: 'abc', imageUrl: 'https://i.redd.it/abc.jpg' }]);
  });

  it('accepts a direct .png link without a post_hint', () => {
    expect(extractMedia({ ...BASE_POST, url: 'https://example.com/x.png?w=10' })).toHaveLength(1);
  });

  it('returns nothing for video, self and plain link posts', () => {
    expect(extractMedia({ ...BASE_POST, is_video: true, url: 'https://v.redd.it/x' })).toEqual([]);
    expect(extractMedia({ ...BASE_POST, is_self: true })).toEqual([]);
    expect(extractMedia({ ...BASE_POST, url: 'https://example.com/article' })).toEqual([]);
  });

  it('expands a gallery into one item per valid image, decoding &amp;', () => {
    const galleryPost: RedditPostData = {
      ...BASE_POST,
      is_gallery: true,
      gallery_data: { items: [{ media_id: 'm1' }, { media_id: 'm2' }, { media_id: 'm3' }] },
      media_metadata: {
        m1: { status: 'valid', e: 'Image', s: { u: 'https://preview.redd.it/m1.jpg?width=1&amp;s=x' } },
        m2: { status: 'valid', e: 'AnimatedImage', s: { u: 'https://preview.redd.it/m2.gif' } },
        m3: { status: 'failed', e: 'Image' },
      },
    };
    expect(extractMedia(galleryPost)).toEqual([{ platformPostId: 'abc:m1', imageUrl: 'https://preview.redd.it/m1.jpg?width=1&s=x' }]);
  });
});

describe('toPlatformPost', () => {
  it('maps a Reddit post to the platform-neutral shape', () => {
    const platformPost = toPlatformPost({ ...BASE_POST, post_hint: 'image', url: 'https://i.redd.it/abc.jpg' });
    expect(platformPost).toMatchObject({
      sourcePostId: 't3_abc',
      author: 'someone',
      permalinkUrl: 'https://www.reddit.com/r/pics/comments/abc/a_photo/',
      postedAt: new Date(1_790_000_000_000),
    });
    expect(platformPost.mediaList).toHaveLength(1);
  });
});

describe('parseListingPage', () => {
  it('reads children and the after cursor', () => {
    const listingPage = parseListingPage({ data: { children: [{ data: BASE_POST }], after: 't3_next' } });
    expect(listingPage.postList).toHaveLength(1);
    expect(listingPage.nextCursor).toBe('t3_next');
  });

  it('tolerates an empty or malformed body', () => {
    expect(parseListingPage({})).toEqual({ postList: [], nextCursor: undefined });
  });
});
