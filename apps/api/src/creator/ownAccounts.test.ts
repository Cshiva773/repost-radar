import { describe, expect, it } from 'vitest';
import { fromStoredAccounts, normaliseHandle, parseOwnAccountList, toStoredAccounts } from './ownAccounts.js';

describe('own accounts', () => {
  it('stores handles the way posts store their author', () => {
    expect(normaliseHandle(' @Dana.bsky.social ')).toBe('dana.bsky.social');
    expect(normaliseHandle('u/Dana_Shoots')).toBe('dana_shoots');
    expect(normaliseHandle('/u/dana_shoots')).toBe('dana_shoots');
  });

  it('parses, normalises and de-duplicates a list', () => {
    const parseResult = parseOwnAccountList([
      { platform: 'bluesky', handle: '@Dana.bsky.social' }, { platform: 'reddit', handle: 'u/dana_shoots' }, { platform: 'bluesky', handle: 'dana.bsky.social' },
    ]);
    expect(parseResult).toEqual({ isError: false, ownAccountList: [{ platform: 'bluesky', handle: 'dana.bsky.social' }, { platform: 'reddit', handle: 'dana_shoots' }] });
  });

  it('keeps the stored list when the field is omitted, and clears it with an empty list', () => {
    expect(parseOwnAccountList(undefined)).toEqual({ isError: false, ownAccountList: null });
    expect(parseOwnAccountList([])).toEqual({ isError: false, ownAccountList: [] });
  });

  it('rejects unknown platforms, bad handles and too many accounts', () => {
    expect(parseOwnAccountList([{ platform: 'myspace', handle: 'dana' }]).isError).toBe(true);
    expect(parseOwnAccountList([{ platform: 'reddit', handle: 'dana shoots' }]).isError).toBe(true);
    expect(parseOwnAccountList([{ platform: 'reddit', handle: '' }]).isError).toBe(true);
    expect(parseOwnAccountList('dana').isError).toBe(true);
    expect(parseOwnAccountList(Array.from({ length: 21 }, (_unused, index) => ({ platform: 'reddit', handle: `dana${index}` }))).isError).toBe(true);
  });

  it('round-trips through the stored "platform:handle" form', () => {
    const ownAccountList = [{ platform: 'bluesky', handle: 'dana.bsky.social' }];
    expect(toStoredAccounts(ownAccountList)).toEqual(['bluesky:dana.bsky.social']);
    expect(fromStoredAccounts(toStoredAccounts(ownAccountList))).toEqual(ownAccountList);
    expect(fromStoredAccounts(null)).toEqual([]);
  });
});
