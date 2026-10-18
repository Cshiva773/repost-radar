import { describe, expect, it } from 'vitest';
import { compareArtistWithLegalName, formatFileTakenAt, formatProofDate, hasStatedProof } from './ownershipProof';

describe('ownership proof helpers', () => {
  it('counts only what the creator typed in as added proof', () => {
    expect(hasStatedProof({ firstPublishedUrl: null, firstPublishedOn: null, ownershipNote: null })).toBe(false);
    expect(hasStatedProof({ firstPublishedUrl: null, firstPublishedOn: '2024-05-01', ownershipNote: null })).toBe(true);
  });

  it('matches the file artist against the legal name, ignoring case and punctuation', () => {
    expect(compareArtistWithLegalName('Dana Example Photography', 'Dana Example')).toBe('matches');
    expect(compareArtistWithLegalName('DANA EXAMPLE', 'dana example')).toBe('matches');
    expect(compareArtistWithLegalName('Dana-Example', 'Dana Example')).toBe('matches');
    expect(compareArtistWithLegalName('Mallory Smith', 'Dana Example')).toBe('differs');
  });

  it('says nothing when either name is missing', () => {
    expect(compareArtistWithLegalName(null, 'Dana Example')).toBeUndefined();
    expect(compareArtistWithLegalName('Dana Example', null)).toBeUndefined();
    expect(compareArtistWithLegalName('©', 'Dana Example')).toBeUndefined();
  });

  it('shows dates exactly as stored, without shifting them by a time zone', () => {
    expect(formatProofDate('2024-05-01')).toContain('2024');
    expect(formatProofDate('2024-05-01')).toContain('1');
    expect(formatFileTakenAt('2024-04-28T18:42:13')).toContain('18:42');
    expect(formatProofDate(null)).toBeUndefined();
    expect(formatFileTakenAt('not a date')).toBeUndefined();
  });
});
