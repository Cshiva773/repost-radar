import { describe, expect, it } from 'vitest';
import { rankSourceSuggestions } from './sourceSuggestions.js';

describe('rankSourceSuggestions', () => {
  it('normalises and merges, drops watched, invalid and disabled-platform targets, and ranks by matches', () => {
    const suggestionList = rankSourceSuggestions(
      [
        { platform: 'reddit', relatedTarget: 'EarthPorn', matchCount: 2 },
        { platform: 'reddit', relatedTarget: 'r/earthporn', matchCount: 1 },
        { platform: 'reddit', relatedTarget: 'pics', matchCount: 5 },
        { platform: 'reddit', relatedTarget: 'not a subreddit!', matchCount: 9 },
        { platform: 'bluesky', relatedTarget: '#landscape', matchCount: 4 },
        { platform: 'myspace', relatedTarget: 'x', matchCount: 9 },
      ],
      [{ platform: 'reddit', targetName: 'Pics' }],
      ['reddit', 'bluesky'],
    );
    expect(suggestionList.map((suggestion) => [suggestion.platform, suggestion.targetName, suggestion.matchCount])).toEqual([
      ['bluesky', '#landscape', 4], ['reddit', 'EarthPorn', 3],
    ]);
    expect(suggestionList[1]?.targetUrl).toBe('https://www.reddit.com/r/EarthPorn/');
  });

  it('suggests nothing for platforms that are not enabled', () => {
    expect(rankSourceSuggestions([{ platform: 'bluesky', relatedTarget: '#landscape', matchCount: 4 }], [], ['reddit'])).toEqual([]);
  });
});
