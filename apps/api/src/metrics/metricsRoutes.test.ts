import { describe, expect, it } from 'vitest';
import { groupRequestCounts } from './metricsRoutes.js';

describe('groupRequestCounts', () => {
  it('regroups "<platform>:<status>" counters by status and by platform', () => {
    expect(groupRequestCounts({ 'reddit:200': 40, 'reddit:429': 2, 'bluesky:200': 10 })).toEqual({
      byStatus: { 200: 50, 429: 2 },
      byPlatform: { reddit: { 200: 40, 429: 2 }, bluesky: { 200: 10 } },
    });
  });

  it('files legacy counters without a platform under "unknown"', () => {
    expect(groupRequestCounts({ 200: 3 })).toEqual({ byStatus: { 200: 3 }, byPlatform: { unknown: { 200: 3 } } });
  });
});
