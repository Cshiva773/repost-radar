import { describe, expect, it } from 'vitest';
import { classifyCheckedPosts, uniqueSourcePostIds } from './recheckSources.js';

const GALLERY_POST_LIST = [
  { crawledPostId: 1, platform: 'reddit', sourcePostId: 't3_gallery' },
  { crawledPostId: 2, platform: 'reddit', sourcePostId: 't3_gallery' },
  { crawledPostId: 3, platform: 'reddit', sourcePostId: 't3_single' },
  { crawledPostId: 4, platform: 'reddit', sourcePostId: 't3_unknown' },
];

describe('recheck planning', () => {
  it('asks once per source post and caps the batch', () => {
    expect(uniqueSourcePostIds(GALLERY_POST_LIST, 25)).toEqual(['t3_gallery', 't3_single', 't3_unknown']);
    expect(uniqueSourcePostIds(GALLERY_POST_LIST, 2)).toEqual(['t3_gallery', 't3_single']);
  });

  it('maps answers back to every crawled image and leaves unknown posts alone', () => {
    const existenceMap = new Map([['t3_gallery', false], ['t3_single', true]]);
    expect(classifyCheckedPosts(GALLERY_POST_LIST, existenceMap)).toEqual({ presentCrawledPostIdList: [3], removedCrawledPostIdList: [1, 2] });
  });
});
