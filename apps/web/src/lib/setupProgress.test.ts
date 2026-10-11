import { describe, expect, it } from 'vitest';
import type { CreatorProfile, WatchTargetStatus } from './api';
import { buildSetupProgress, describeWatching } from './setupProgress';

const READY_PROFILE: CreatorProfile = {
  creatorId: 1, name: 'Dana', legalName: 'Dana Example', contactEmail: 'dana@example.com', mailingAddress: '1 Example Street', timeZone: 'UTC', isNoticeReady: true,
};

function buildWatchTarget(overrideDetails: Partial<WatchTargetStatus>): WatchTargetStatus {
  return {
    watchTargetId: 1, platform: 'bluesky', targetName: '@esa.int', pollIntervalSeconds: 300, enabled: true,
    lastCrawledAt: null, lastError: null, postsSeenCount: 0, candidatesFoundCount: 0, ...overrideDetails,
  };
}

describe('buildSetupProgress', () => {
  it('waits until details, originals and sources have all loaded', () => {
    expect(buildSetupProgress(undefined, 0, [])).toBeUndefined();
    expect(buildSetupProgress(READY_PROFILE, undefined, [])).toBeUndefined();
    expect(buildSetupProgress(READY_PROFILE, 0, undefined)).toBeUndefined();
  });

  it('starts an empty install at details, with nothing done', () => {
    const setupProgress = buildSetupProgress({ ...READY_PROFILE, isNoticeReady: false }, 0, []);
    expect(setupProgress).toMatchObject({ doneCount: 0, isComplete: false, nextStepName: 'details' });
  });

  it('points at the first missing step, in setup order', () => {
    expect(buildSetupProgress(READY_PROFILE, 0, [])?.nextStepName).toBe('originals');
    expect(buildSetupProgress({ ...READY_PROFILE, isNoticeReady: false }, 3, [buildWatchTarget({})])?.nextStepName).toBe('details');
    expect(buildSetupProgress(READY_PROFILE, 3, [])).toMatchObject({ doneCount: 2, nextStepName: 'sources' });
  });

  it('does not count paused sources as watching', () => {
    expect(buildSetupProgress(READY_PROFILE, 3, [buildWatchTarget({ enabled: false })])?.isComplete).toBe(false);
  });

  it('is complete once all three are done', () => {
    expect(buildSetupProgress(READY_PROFILE, 3, [buildWatchTarget({})])).toMatchObject({ doneCount: 3, isComplete: true, nextStepName: undefined });
  });
});

describe('describeWatching', () => {
  const nowMs = Date.parse('2026-10-11T12:00:00Z');

  it('says when the newest check ran, ignoring paused sources', () => {
    const watchTargetList = [
      buildWatchTarget({ lastCrawledAt: '2026-10-11T11:50:00Z' }),
      buildWatchTarget({ lastCrawledAt: '2026-10-11T11:58:00Z' }),
      buildWatchTarget({ enabled: false, lastCrawledAt: '2026-10-11T11:59:50Z' }),
    ];
    expect(describeWatching(watchTargetList, nowMs)).toBe('Watching 2 sources, last checked 2 min ago.');
  });

  it('says the first check is coming when nothing has run yet', () => {
    expect(describeWatching([buildWatchTarget({})], nowMs)).toBe('Watching 1 source. The first check runs within a few minutes.');
  });
});
