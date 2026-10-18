import { describe, expect, it } from 'vitest';
import { extractMedia, isAdultLabelled, parseAuthorFeedPage, parsePostUri, parseSearchPage, toPlatformPost, type BlueskyPostView } from './feed.js';

// Shapes follow real AppView responses (searchPosts / getAuthorFeed); values are synthetic
const IMAGE_POST: BlueskyPostView = {
  uri: 'at://did:plc:abc123/app.bsky.feed.post/3kpost1',
  author: { did: 'did:plc:abc123', handle: 'artist.bsky.social' },
  record: { createdAt: '2026-10-10T08:20:04.641Z', text: 'Sunset over the bay' },
  embed: {
    $type: 'app.bsky.embed.images#view',
    images: [
      { fullsize: 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc123/bafy1@jpeg' },
      { fullsize: 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc123/bafy2@jpeg' },
    ],
  },
  indexedAt: '2026-10-10T08:20:11.754Z',
};

describe('parsePostUri', () => {
  it('splits an at:// post URI', () => {
    expect(parsePostUri(IMAGE_POST.uri)).toEqual({ did: 'did:plc:abc123', recordKey: '3kpost1' });
    expect(parsePostUri('https://bsky.app/x')).toBeUndefined();
  });
});

describe('extractMedia', () => {
  it('returns one item per full-size image with unique ids', () => {
    expect(extractMedia(IMAGE_POST, false).map((media) => media.platformPostId)).toEqual(['did:plc:abc123/3kpost1:0', 'did:plc:abc123/3kpost1:1']);
  });

  it('reads images inside a quote post (recordWithMedia)', () => {
    const quotePost: BlueskyPostView = { ...IMAGE_POST, embed: { $type: 'app.bsky.embed.recordWithMedia#view', media: IMAGE_POST.embed } };
    expect(extractMedia(quotePost, false)).toHaveLength(2);
  });

  it('returns nothing for text-only, external-link and video posts', () => {
    expect(extractMedia({ ...IMAGE_POST, embed: undefined }, false)).toEqual([]);
    expect(extractMedia({ ...IMAGE_POST, embed: { $type: 'app.bsky.embed.external#view' } }, false)).toEqual([]);
    expect(extractMedia({ ...IMAGE_POST, embed: { $type: 'app.bsky.embed.video#view' } }, false)).toEqual([]);
  });

  it('skips adult-labelled posts unless explicitly included', () => {
    const labelledPost: BlueskyPostView = { ...IMAGE_POST, labels: [{ val: 'porn' }] };
    const selfLabelledPost: BlueskyPostView = { ...IMAGE_POST, record: { ...IMAGE_POST.record, labels: { values: [{ val: 'nudity' }] } } };
    expect(isAdultLabelled(labelledPost) && isAdultLabelled(selfLabelledPost)).toBe(true);
    expect(extractMedia(labelledPost, false)).toEqual([]);
    expect(extractMedia(selfLabelledPost, true)).toHaveLength(2);
  });
});

describe('toPlatformPost', () => {
  it('uses indexedAt for ordering and builds the bsky.app permalink', () => {
    expect(toPlatformPost(IMAGE_POST, false)).toMatchObject({
      sourcePostId: IMAGE_POST.uri,
      postedAt: new Date('2026-10-10T08:20:11.754Z'),
      author: 'artist.bsky.social',
      title: 'Sunset over the bay',
      permalinkUrl: 'https://bsky.app/profile/artist.bsky.social/post/3kpost1',
    });
  });
});

describe('page parsers', () => {
  it('reads a search page and its cursor', () => {
    const searchPage = parseSearchPage({ posts: [IMAGE_POST], cursor: 'eyJzIjpbMV19' }, false);
    expect(searchPage.postList).toHaveLength(1);
    expect(searchPage.nextCursor).toBe('eyJzIjpbMV19');
  });

  it('reads an author feed, skipping reposts, and treats a missing cursor as the end', () => {
    const feedPage = parseAuthorFeedPage({ feed: [{ post: IMAGE_POST }, { post: IMAGE_POST, reason: { $type: 'app.bsky.feed.defs#reasonRepost' } }] }, false);
    expect(feedPage.postList).toHaveLength(1);
    expect(feedPage.nextCursor).toBeUndefined();
  });

  it('tolerates an empty body', () => {
    expect(parseSearchPage({}, false)).toEqual({ postList: [], nextCursor: undefined });
  });
});
