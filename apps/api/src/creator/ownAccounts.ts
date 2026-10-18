import { findPlatformDefinition } from '@repost-radar/platforms';

// The creator's own accounts. Stored as "platform:handle" so a match's post can be compared in SQL with
// (platform || ':' || lower(author)) = ANY(own_accounts); see candidateRepository and decisionService.

export interface OwnAccountDetails {
  platform: string;
  handle: string;
}

export const MAX_OWN_ACCOUNTS = 20;
// Reddit usernames and Bluesky handles: letters, digits, dots, hyphens, underscores
const HANDLE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;

type ParseResult = { isError: false; ownAccountList: OwnAccountDetails[] | null } | { isError: true; message: string };

// "@Dana.bsky.social" → "dana.bsky.social", "u/Dana_Shoots" → "dana_shoots": the form posts are stored in
export function normaliseHandle(rawHandle: string): string {
  return rawHandle.trim().replace(/^@/, '').replace(/^\/?u\//i, '').toLowerCase();
}

export function toStoredAccounts(ownAccountList: OwnAccountDetails[]): string[] {
  return ownAccountList.map((ownAccount) => `${ownAccount.platform}:${ownAccount.handle}`);
}

export function fromStoredAccounts(storedAccountList: string[] | null | undefined): OwnAccountDetails[] {
  return (storedAccountList ?? []).map((storedAccount) => {
    const separatorIndex = storedAccount.indexOf(':');
    return { platform: storedAccount.slice(0, separatorIndex), handle: storedAccount.slice(separatorIndex + 1) };
  });
}

function parseOneAccount(rawAccount: unknown): OwnAccountDetails | string {
  const { platform, handle } = (rawAccount ?? {}) as { platform?: unknown; handle?: unknown };
  if (!findPlatformDefinition(platform)) return `Unknown platform "${String(platform)}"`;
  const normalisedHandle = typeof handle === 'string' ? normaliseHandle(handle) : '';
  if (!HANDLE_PATTERN.test(normalisedHandle)) return `"${String(handle)}" is not a valid account name`;
  return { platform: String(platform), handle: normalisedHandle };
}

// Omitted keeps the stored list (null); an array replaces it, de-duplicated
export function parseOwnAccountList(rawValue: unknown): ParseResult {
  if (rawValue === undefined || rawValue === null) return { isError: false, ownAccountList: null };
  if (!Array.isArray(rawValue) || rawValue.length > MAX_OWN_ACCOUNTS) return { isError: true, message: `ownAccountList must be a list of at most ${MAX_OWN_ACCOUNTS} accounts` };
  const ownAccountList: OwnAccountDetails[] = [];
  for (const rawAccount of rawValue) {
    const parsedAccount = parseOneAccount(rawAccount);
    if (typeof parsedAccount === 'string') return { isError: true, message: parsedAccount };
    const isDuplicate = ownAccountList.some((ownAccount) => ownAccount.platform === parsedAccount.platform && ownAccount.handle === parsedAccount.handle);
    if (!isDuplicate) ownAccountList.push(parsedAccount);
  }
  return { isError: false, ownAccountList };
}
