import { describe, expect, it } from 'vitest';
import { postHashtags } from './bluesky/feed.js';
import { crosspostSubreddits } from './reddit/listing.js';

describe('related targets', () => {
  it('takes crosspost parents, minus the post’s own subreddit, once each', () => {
    const postData = { id: 'x', name: 't3_x', created_utc: 0, subreddit: 'pics',
      crosspost_parent_list: [{ subreddit: 'EarthPorn' }, { subreddit: 'Pics' }, { subreddit: 'EarthPorn' }, {}] };
    expect(crosspostSubreddits(postData)).toEqual(['EarthPorn']);
  });

  it('reads Bluesky tag facets as lowercased #tags and ignores links and mentions', () => {
    const postView = { uri: 'at://did:plc:a/app.bsky.feed.post/1', record: { facets: [
      { features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'Landscape' }] },
      { features: [{ $type: 'app.bsky.richtext.facet#link' }] },
      { features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'landscape' }, { $type: 'app.bsky.richtext.facet#tag', tag: 'sunset' }] },
    ] } };
    expect(postHashtags(postView)).toEqual(['#landscape', '#sunset']);
  });
});
