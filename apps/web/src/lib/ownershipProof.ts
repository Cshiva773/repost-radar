import type { AssetSummary } from './api';

export type ArtistComparison = 'matches' | 'differs' | undefined;

const DISPLAY_DATE_FORMAT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const DISPLAY_DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });

// Proof the creator typed in (the file's metadata is shown separately and isn't "added")
export function hasStatedProof(asset: Pick<AssetSummary, 'firstPublishedUrl' | 'firstPublishedOn' | 'ownershipNote'>): boolean {
  return Boolean(asset.firstPublishedUrl || asset.firstPublishedOn || asset.ownershipNote);
}

function normaliseName(nameText: string): string {
  return nameText.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Does the Artist field in the file name the creator? "Dana Example Photography" matches "Dana Example"
export function compareArtistWithLegalName(fileArtist: string | null, legalName: string | null): ArtistComparison {
  if (!fileArtist || !legalName) return undefined;
  const artistText = normaliseName(fileArtist);
  const legalNameText = normaliseName(legalName);
  if (!artistText || !legalNameText) return undefined;
  return artistText.includes(legalNameText) || legalNameText.includes(artistText) ? 'matches' : 'differs';
}

// A calendar date (YYYY-MM-DD) or the camera's zoneless clock, shown exactly as stored, never shifted by a zone
export function formatProofDate(dateText: string | null): string | undefined {
  if (!dateText) return undefined;
  const parsedDate = new Date(`${dateText.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsedDate.getTime()) ? undefined : DISPLAY_DATE_FORMAT.format(parsedDate);
}

export function formatFileTakenAt(exifTakenAt: string | null): string | undefined {
  if (!exifTakenAt) return undefined;
  const parsedDate = new Date(`${exifTakenAt}Z`);
  return Number.isNaN(parsedDate.getTime()) ? undefined : DISPLAY_DATE_TIME_FORMAT.format(parsedDate);
}
