import { describe, expect, it } from 'vitest';
import { parseBlueskyPostExistence } from './bluesky/postExistence.js';
import { parseRedditPostExistence } from './reddit/postExistence.js';

describe('parseRedditPostExistence', () => {
  it('treats missing, removed and author-deleted posts as gone', () => {
    const infoJson = { data: { children: [
      { data: { name: 't3_live', author: 'someone', removed_by_category: null } },
      { data: { name: 't3_modded', author: 'someone', removed_by_category: 'moderator' } },
      { data: { name: 't3_selfdel', author: '[deleted]', removed_by_category: null } },
    ] } };
    expect(Object.fromEntries(parseRedditPostExistence(infoJson, ['t3_live', 't3_modded', 't3_selfdel', 't3_missing']))).toEqual({
      t3_live: true, t3_modded: false, t3_selfdel: false, t3_missing: false,
    });
  });
});

describe('parseBlueskyPostExistence', () => {
  it('marks URIs absent from getPosts as gone', () => {
    const presentUri = 'at://did:plc:a/app.bsky.feed.post/1';
    const goneUri = 'at://did:plc:a/app.bsky.feed.post/2';
    expect(Object.fromEntries(parseBlueskyPostExistence({ posts: [{ uri: presentUri }] }, [presentUri, goneUri]))).toEqual({ [presentUri]: true, [goneUri]: false });
  });
});
