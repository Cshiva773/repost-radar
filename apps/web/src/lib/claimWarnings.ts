import type { AssetSummary } from './api';
import { compareArtistWithLegalName } from './ownershipProof';

// Warnings before approving a claim. Advisory: the creator may still approve (they own the install), but
// sees, twice, when the evidence points the other way. Calendar dates in UTC, the same rule as the worker's
// earliest_proof (workers/fingerprint/src/fingerprint_worker/evidence.py), which records it in metadata.json.

export type ProofSource = 'firstPublished' | 'fileTakenAt' | 'uploaded';

export interface EarliestProofDetails {
  /** YYYY-MM-DD */
  provenOn: string;
  source: ProofSource;
}

export type ClaimWarning =
  | { kind: 'postedBeforeProof'; postedOn: string; earliestProof: EarliestProofDetails }
  | { kind: 'fileNamesSomeoneElse'; fileArtist: string; legalName: string };

type ProofFields = Pick<AssetSummary, 'firstPublishedOn' | 'exifTakenAt' | 'createdAt'>;

export function findEarliestProof(asset: ProofFields): EarliestProofDetails | undefined {
  const datedSourceList: { provenOn: string | null; source: ProofSource }[] = [
    { provenOn: asset.firstPublishedOn, source: 'firstPublished' },
    { provenOn: asset.exifTakenAt?.slice(0, 10) ?? null, source: 'fileTakenAt' },
    { provenOn: asset.createdAt ? new Date(asset.createdAt).toISOString().slice(0, 10) : null, source: 'uploaded' },
  ];
  const presentList = datedSourceList.filter((datedSource): datedSource is EarliestProofDetails => Boolean(datedSource.provenOn));
  return presentList.reduce<EarliestProofDetails | undefined>((earliest, datedSource) => (!earliest || datedSource.provenOn < earliest.provenOn ? datedSource : earliest), undefined);
}

export function findClaimWarnings(postedAt: string | null, asset: (ProofFields & Pick<AssetSummary, 'exifArtist'>) | undefined, legalName: string | null): ClaimWarning[] {
  if (!asset) return [];
  const claimWarningList: ClaimWarning[] = [];
  const earliestProof = findEarliestProof(asset);
  const postedOn = postedAt ? new Date(postedAt).toISOString().slice(0, 10) : undefined;
  if (postedOn && earliestProof && postedOn < earliestProof.provenOn) claimWarningList.push({ kind: 'postedBeforeProof', postedOn, earliestProof });
  if (asset.exifArtist && legalName && compareArtistWithLegalName(asset.exifArtist, legalName) === 'differs') {
    claimWarningList.push({ kind: 'fileNamesSomeoneElse', fileArtist: asset.exifArtist, legalName });
  }
  return claimWarningList;
}
