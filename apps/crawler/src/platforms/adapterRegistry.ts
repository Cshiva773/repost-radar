// Service discovery for platform adapters: the crawl loop asks for an adapter by name and never
// imports a platform directly. Register a new platform's factory in ADAPTER_FACTORY_LIST.
import { findPlatformDefinition, parseEnabledPlatforms } from '@repost-radar/platforms';
import { blueskyAdapterFactory } from './bluesky/blueskyAdapter.js';
import { redditAdapterFactory } from './reddit/redditAdapter.js';
import type { AdapterDependencies, PlatformAdapter, PlatformAdapterFactory } from './types.js';

const ADAPTER_FACTORY_LIST: readonly PlatformAdapterFactory[] = [redditAdapterFactory, blueskyAdapterFactory];

export interface AdapterRegistryInstance {
  resolveAdapter(platformName: string): PlatformAdapter | undefined;
  listEnabledPlatforms(): string[];
}

export function buildAdapterRegistry(
  environmentDetails: NodeJS.ProcessEnv,
  adapterDependencies: AdapterDependencies,
  adapterFactoryList: readonly PlatformAdapterFactory[] = ADAPTER_FACTORY_LIST,
): AdapterRegistryInstance {
  const { enabledPlatformList, unknownPlatformList } = parseEnabledPlatforms(environmentDetails.ENABLED_PLATFORMS);
  if (unknownPlatformList.length) throw new Error(`ENABLED_PLATFORMS has unknown platform(s): ${unknownPlatformList.join(', ')}`);

  const adapterByPlatform = new Map<string, PlatformAdapter>();
  for (const platformName of enabledPlatformList) {
    const adapterFactory = adapterFactoryList.find((factory) => factory.platformName === platformName);
    if (!adapterFactory) throw new Error(`Platform "${platformName}" is defined but has no crawler adapter registered`);
    if (!findPlatformDefinition(platformName)) throw new Error(`Platform "${platformName}" has an adapter but no definition`);
    adapterByPlatform.set(platformName, adapterFactory.createAdapter(environmentDetails, adapterDependencies));
  }

  return {
    resolveAdapter: (platformName) => adapterByPlatform.get(platformName),
    listEnabledPlatforms: () => [...adapterByPlatform.keys()],
  };
}
