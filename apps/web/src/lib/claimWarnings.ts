import type { AssetSummary } from './api';
import { compareArtistWithLegalName } from './ownershipProof';

// Warnings before approving a claim. Advisory: the creator may still approve (they own the install), but
// sees, twice, when the evidence points the other way. Same rule as the worker's earliest_proof
// (workers/fingerprint/src/fingerprint_worker/evidence.py), which records it in metadata.json: a first-published
// date and a date taken (the camera's clock has no zone) count from the start of their day (UTC), in the creator's
// favour; the upload time is exact, so a copy posted earlier the same day still counts as earlier.

export type ProofSource = 'firstPublished' | 'fileTakenAt' | 'uploaded';

export interface EarliestProofDetails {
  /** YYYY-MM-DD, for display */
  provenOn: string;
  /** The moment compared with the post */
  provenAtMs: number;
  source: ProofSource;
}

export type ClaimWarning =
  | { kind: 'postedBeforeProof'; postedOn: string; postedAtMs: number; earliestProof: EarliestProofDetails }
  | { kind: 'fileNamesSomeoneElse'; fileArtist: string; legalName: string };

type ProofFields = Pick<AssetSummary, 'firstPublishedOn' | 'exifTakenAt' | 'createdAt'>;

function startOfDayMs(dateText: string | null | undefined): number | undefined {
  if (!dateText) return undefined;
  const parsedMs = Date.parse(`${dateText.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsedMs) ? undefined : parsedMs;
}

function exactMs(timestampText: string | null | undefined): number | undefined {
  const parsedMs = timestampText ? Date.parse(timestampText) : NaN;
  return Number.isNaN(parsedMs) ? undefined : parsedMs;
}

export function findEarliestProof(asset: ProofFields): EarliestProofDetails | undefined {
  const timedSourceList: { provenAtMs: number | undefined; source: ProofSource }[] = [
    { provenAtMs: startOfDayMs(asset.firstPublishedOn), source: 'firstPublished' },
    { provenAtMs: startOfDayMs(asset.exifTakenAt), source: 'fileTakenAt' },
    { provenAtMs: exactMs(asset.createdAt), source: 'uploaded' },
  ];
  return timedSourceList.reduce<EarliestProofDetails | undefined>((earliest, timedSource) => {
    if (timedSource.provenAtMs === undefined || (earliest && earliest.provenAtMs <= timedSource.provenAtMs)) return earliest;
    return { provenAtMs: timedSource.provenAtMs, provenOn: new Date(timedSource.provenAtMs).toISOString().slice(0, 10), source: timedSource.source };
  }, undefined);
}

export function findClaimWarnings(postedAt: string | null, asset: (ProofFields & Pick<AssetSummary, 'exifArtist'>) | undefined, legalName: string | null): ClaimWarning[] {
  if (!asset) return [];
  const claimWarningList: ClaimWarning[] = [];
  const earliestProof = findEarliestProof(asset);
  const postedAtMs = exactMs(postedAt);
  if (postedAtMs !== undefined && earliestProof && postedAtMs < earliestProof.provenAtMs) {
    claimWarningList.push({ kind: 'postedBeforeProof', postedOn: new Date(postedAtMs).toISOString().slice(0, 10), postedAtMs, earliestProof });
  }
  if (asset.exifArtist && legalName && compareArtistWithLegalName(asset.exifArtist, legalName) === 'differs') {
    claimWarningList.push({ kind: 'fileNamesSomeoneElse', fileArtist: asset.exifArtist, legalName });
  }
  return claimWarningList;
}
