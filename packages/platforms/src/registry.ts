// The single list of known platforms. Adding one = a new definition file + one entry here,
// plus a crawler adapter registered under the same platformName (docs/ADDING_A_PLATFORM.md).
import { redditDefinition } from './reddit.js';
import type { PlatformDefinition } from './types.js';

export const DEFAULT_PLATFORM_NAME = 'reddit';

const PLATFORM_DEFINITION_LIST: readonly PlatformDefinition[] = [redditDefinition];

export function listPlatformDefinitions(): readonly PlatformDefinition[] {
  return PLATFORM_DEFINITION_LIST;
}

export function findPlatformDefinition(platformName: unknown): PlatformDefinition | undefined {
  if (typeof platformName !== 'string') return undefined;
  const wantedName = platformName.trim().toLowerCase();
  return PLATFORM_DEFINITION_LIST.find((definition) => definition.platformName === wantedName);
}

/**
 * Parses ENABLED_PLATFORMS (comma-separated). Unknown names are reported, not silently dropped,
 * so a typo in config fails loudly at startup.
 */
export function parseEnabledPlatforms(rawEnabledPlatforms: string | undefined): { enabledPlatformList: string[]; unknownPlatformList: string[] } {
  const requestedNameList = (rawEnabledPlatforms ?? DEFAULT_PLATFORM_NAME)
    .split(',')
    .map((platformName) => platformName.trim().toLowerCase())
    .filter(Boolean);
  const enabledPlatformList = [...new Set(requestedNameList.filter((platformName) => findPlatformDefinition(platformName)))];
  const unknownPlatformList = requestedNameList.filter((platformName) => !findPlatformDefinition(platformName));
  return { enabledPlatformList, unknownPlatformList };
}
