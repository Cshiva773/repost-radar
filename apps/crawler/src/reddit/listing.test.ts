import { describe, expect, it } from 'vitest';
import { extractImagePosts, parseListingPage, type RedditPostData } from './listing.js';

const BASE_POST: RedditPostData = {
  id: 'abc', name: 't3_abc', author: 'someone', title: 'A photo', permalink: '/r/pics/comments/abc/a_photo/', created_utc: 1_790_000_000,
};

describe('extractImagePosts', () => {
  it('keeps a direct image post', () => {
    const imagePostList = extractImagePosts({ ...BASE_POST, post_hint: 'image', url: 'https://i.redd.it/abc.jpg' });
    expect(imagePostList).toHaveLength(1);
    expect(imagePostList[0]).toMatchObject({ platformPostId: 'abc', redditPostId: 't3_abc', imageUrl: 'https://i.redd.it/abc.jpg' });
    expect(imagePostList[0]?.permalinkUrl).toBe('https://www.reddit.com/r/pics/comments/abc/a_photo/');
  });

  it('accepts a direct .png link without a post_hint', () => {
    expect(extractImagePosts({ ...BASE_POST, url: 'https://example.com/x.png?w=10' })).toHaveLength(1);
  });

  it('skips video, self and plain link posts', () => {
    expect(extractImagePosts({ ...BASE_POST, is_video: true, url: 'https://v.redd.it/x' })).toEqual([]);
    expect(extractImagePosts({ ...BASE_POST, is_self: true })).toEqual([]);
    expect(extractImagePosts({ ...BASE_POST, url: 'https://example.com/article' })).toEqual([]);
  });

  it('expands a gallery into one row per valid image, decoding &amp;', () => {
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
    const imagePostList = extractImagePosts(galleryPost);
    expect(imagePostList.map((post) => post.platformPostId)).toEqual(['abc:m1']);
    expect(imagePostList[0]?.imageUrl).toBe('https://preview.redd.it/m1.jpg?width=1&s=x');
  });
});

describe('parseListingPage', () => {
  it('reads children and the after cursor', () => {
    const listingPage = parseListingPage({ data: { children: [{ data: BASE_POST }], after: 't3_next' } });
    expect(listingPage.postList).toHaveLength(1);
    expect(listingPage.afterCursor).toBe('t3_next');
  });

  it('tolerates an empty or malformed body', () => {
    expect(parseListingPage({})).toEqual({ postList: [], afterCursor: undefined });
  });
});
