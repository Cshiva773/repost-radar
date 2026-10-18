import { describe, expect, it } from 'vitest';
import { isPlausiblePublishedDate, isPublicWebUrl, parseOwnershipProofBody } from './ownershipProof.js';

const NOW_MS = Date.parse('2026-10-18T12:00:00Z');

describe('parseOwnershipProofBody', () => {
  it('accepts a full proof and trims it', () => {
    const parseResult = parseOwnershipProofBody({ firstPublishedUrl: ' https://dana.photo/lighthouse ', firstPublishedOn: '2024-05-01', ownershipNote: ' RAW on request ' }, NOW_MS);
    expect(parseResult).toEqual({ isError: false, proofInput: { firstPublishedUrl: 'https://dana.photo/lighthouse', firstPublishedOn: '2024-05-01', ownershipNote: 'RAW on request' } });
  });

  it('treats missing or blank fields as cleared', () => {
    expect(parseOwnershipProofBody({ firstPublishedUrl: '  ', ownershipNote: null }, NOW_MS)).toEqual({
      isError: false, proofInput: { firstPublishedUrl: null, firstPublishedOn: null, ownershipNote: null },
    });
  });

  it('rejects a link that is not a public web address', () => {
    for (const firstPublishedUrl of ['javascript:alert(1)', 'ftp://dana.photo/x', 'dana.photo/x', 'http://localhost/x', 42]) {
      expect(parseOwnershipProofBody({ firstPublishedUrl }, NOW_MS).isError).toBe(true);
    }
  });

  it('rejects impossible, ancient or future dates', () => {
    for (const firstPublishedOn of ['2024-02-30', '1850-01-01', '2026-10-25', '01/05/2024']) {
      expect(parseOwnershipProofBody({ firstPublishedOn }, NOW_MS).isError).toBe(true);
    }
  });

  it('rejects a note over the length limit', () => {
    expect(parseOwnershipProofBody({ ownershipNote: 'x'.repeat(1001) }, NOW_MS).isError).toBe(true);
  });
});

describe('proof field checks', () => {
  it('allows today in the furthest-ahead time zone', () => {
    expect(isPlausiblePublishedDate('2026-10-19', NOW_MS)).toBe(true);
    expect(isPlausiblePublishedDate('2026-10-20', NOW_MS)).toBe(false);
  });

  it('needs a host with a dot', () => {
    expect(isPublicWebUrl('https://www.instagram.com/p/abc/')).toBe(true);
    expect(isPublicWebUrl('https://intranet/page')).toBe(false);
  });
});
