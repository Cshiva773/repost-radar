import { describe, expect, it } from 'vitest';
import { findClaimWarnings, findEarliestProof } from './claimWarnings';

const UPLOADED_TODAY = { firstPublishedOn: null, exifTakenAt: null, exifArtist: null, createdAt: '2026-10-16T09:00:00.000Z' };

describe('findEarliestProof', () => {
  it('picks the earliest of first published, date taken and upload', () => {
    expect(findEarliestProof({ ...UPLOADED_TODAY, firstPublishedOn: '2024-05-01', exifTakenAt: '2024-04-28T18:42:13' })).toEqual({ provenOn: '2024-04-28', source: 'fileTakenAt' });
    expect(findEarliestProof({ ...UPLOADED_TODAY, firstPublishedOn: '2024-05-01' })).toEqual({ provenOn: '2024-05-01', source: 'firstPublished' });
    expect(findEarliestProof(UPLOADED_TODAY)).toEqual({ provenOn: '2026-10-16', source: 'uploaded' });
  });
});

describe('findClaimWarnings', () => {
  it('warns when the copy was posted before any proof, even only the upload', () => {
    expect(findClaimWarnings('2025-03-12T08:00:00Z', UPLOADED_TODAY, 'Dana Example')).toEqual([
      { kind: 'postedBeforeProof', postedOn: '2025-03-12', earliestProof: { provenOn: '2026-10-16', source: 'uploaded' } },
    ]);
  });

  it('clears that warning once earlier proof is added, and on the same day', () => {
    expect(findClaimWarnings('2025-03-12T08:00:00Z', { ...UPLOADED_TODAY, firstPublishedOn: '2024-05-01' }, 'Dana Example')).toEqual([]);
    expect(findClaimWarnings('2024-05-01T23:00:00Z', { ...UPLOADED_TODAY, firstPublishedOn: '2024-05-01' }, 'Dana Example')).toEqual([]);
  });

  it('warns when the file names someone other than the creator', () => {
    const warningList = findClaimWarnings('2026-10-17T08:00:00Z', { ...UPLOADED_TODAY, exifArtist: 'Mallory Smith' }, 'Dana Example');
    expect(warningList).toEqual([{ kind: 'fileNamesSomeoneElse', fileArtist: 'Mallory Smith', legalName: 'Dana Example' }]);
    expect(findClaimWarnings('2026-10-17T08:00:00Z', { ...UPLOADED_TODAY, exifArtist: 'Dana Example Photography' }, 'Dana Example')).toEqual([]);
  });

  it('says nothing without the original or a post date', () => {
    expect(findClaimWarnings('2025-03-12T08:00:00Z', undefined, 'Dana Example')).toEqual([]);
    expect(findClaimWarnings(null, UPLOADED_TODAY, 'Dana Example')).toEqual([]);
  });
});
