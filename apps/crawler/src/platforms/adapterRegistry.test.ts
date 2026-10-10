import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { buildAdapterRegistry } from './adapterRegistry.js';
import type { AdapterDependencies, PlatformAdapterFactory } from './types.js';

const ADAPTER_DEPENDENCIES: AdapterDependencies = {
  logger: pino({ level: 'silent' }),
  onRequest: () => undefined,
  createTokenBucket: () => ({ take: async () => undefined }),
};

const fakeRedditFactory: PlatformAdapterFactory = {
  platformName: 'reddit',
  createAdapter: () => ({ platformName: 'reddit', userAgent: 'test', fetchNewPage: async () => ({ postList: [], nextCursor: undefined }) }),
};

describe('buildAdapterRegistry', () => {
  it('builds an adapter for each enabled platform and resolves it by name', () => {
    const adapterRegistry = buildAdapterRegistry({ ENABLED_PLATFORMS: 'reddit' }, ADAPTER_DEPENDENCIES, [fakeRedditFactory]);
    expect(adapterRegistry.listEnabledPlatforms()).toEqual(['reddit']);
    expect(adapterRegistry.resolveAdapter('reddit')?.platformName).toBe('reddit');
    expect(adapterRegistry.resolveAdapter('bluesky')).toBeUndefined();
  });

  it('defaults to reddit when ENABLED_PLATFORMS is unset', () => {
    expect(buildAdapterRegistry({}, ADAPTER_DEPENDENCIES, [fakeRedditFactory]).listEnabledPlatforms()).toEqual(['reddit']);
  });

  it('fails loudly on an unknown platform name', () => {
    expect(() => buildAdapterRegistry({ ENABLED_PLATFORMS: 'reddit,myspace' }, ADAPTER_DEPENDENCIES, [fakeRedditFactory]))
      .toThrow('unknown platform(s): myspace');
  });

  it('fails loudly when a defined platform has no adapter registered', () => {
    expect(() => buildAdapterRegistry({ ENABLED_PLATFORMS: 'reddit' }, ADAPTER_DEPENDENCIES, []))
      .toThrow('no crawler adapter registered');
  });

  it('builds the real Reddit adapter in fixture mode without credentials', () => {
    const adapterRegistry = buildAdapterRegistry({ ENABLED_PLATFORMS: 'reddit' }, ADAPTER_DEPENDENCIES);
    expect(adapterRegistry.resolveAdapter('reddit')?.userAgent).toBe('repost-radar/0.1');
  });
});
