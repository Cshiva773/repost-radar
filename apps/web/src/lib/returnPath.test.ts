import { describe, expect, it } from 'vitest';
import { DEFAULT_SIGNED_IN_PATH, resolveReturnPath } from './returnPath';

describe('resolveReturnPath', () => {
  it('returns to the in-app page the reviewer came from, query included', () => {
    expect(resolveReturnPath({ returnTo: '/queue/decided' })).toBe('/queue/decided');
    expect(resolveReturnPath({ returnTo: '/candidates/4?from=pending' })).toBe('/candidates/4?from=pending');
  });

  it('falls back to the queue for missing state, the sign-in page and anything off-site', () => {
    for (const locationState of [null, {}, { returnTo: 42 }, { returnTo: '/login' }, { returnTo: '//evil.example' },
      { returnTo: '/\\evil.example' }, { returnTo: 'https://evil.example/' }]) {
      expect(resolveReturnPath(locationState)).toBe(DEFAULT_SIGNED_IN_PATH);
    }
  });
});
