// What a creator states about first publishing an original. Stored as given and never verified: the review UI,
// the evidence pack and the notice all label it "stated by you".

export interface OwnershipProofInput {
  firstPublishedUrl: string | null;
  /** Calendar date, YYYY-MM-DD */
  firstPublishedOn: string | null;
  ownershipNote: string | null;
}

export const MAX_PROOF_URL_LENGTH = 2000;
export const MAX_OWNERSHIP_NOTE_LENGTH = 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EARLIEST_PUBLISHED_DATE = '1900-01-01';
// Today in the furthest-ahead zone (UTC+14), so a creator's local "today" is never rejected as the future
const LATEST_ZONE_OFFSET_MS = 14 * 60 * 60 * 1000;

type ParseResult = { isError: false; proofInput: OwnershipProofInput } | { isError: true; message: string };

function readOptionalText(rawValue: unknown): string | null | 'invalid' {
  if (rawValue === undefined || rawValue === null) return null;
  if (typeof rawValue !== 'string') return 'invalid';
  return rawValue.trim() || null;
}

export function isPublicWebUrl(urlText: string): boolean {
  try {
    const parsedUrl = new URL(urlText);
    return (parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:') && parsedUrl.hostname.includes('.');
  } catch {
    return false;
  }
}

// A real calendar date (rejects 2024-02-30) between 1900 and today
export function isPlausiblePublishedDate(dateText: string, nowMs: number = Date.now()): boolean {
  if (!DATE_PATTERN.test(dateText)) return false;
  const parsedDate = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateText) return false;
  const latestDateText = new Date(nowMs + LATEST_ZONE_OFFSET_MS).toISOString().slice(0, 10);
  return dateText >= EARLIEST_PUBLISHED_DATE && dateText <= latestDateText;
}

export function parseOwnershipProofBody(rawBody: unknown, nowMs: number = Date.now()): ParseResult {
  const bodyDetails = (rawBody ?? {}) as Record<string, unknown>;
  const firstPublishedUrl = readOptionalText(bodyDetails.firstPublishedUrl);
  const firstPublishedOn = readOptionalText(bodyDetails.firstPublishedOn);
  const ownershipNote = readOptionalText(bodyDetails.ownershipNote);
  if (firstPublishedUrl === 'invalid' || (firstPublishedUrl && (firstPublishedUrl.length > MAX_PROOF_URL_LENGTH || !isPublicWebUrl(firstPublishedUrl)))) {
    return { isError: true, message: 'firstPublishedUrl must be a web address starting with https:// or http://' };
  }
  if (firstPublishedOn === 'invalid' || (firstPublishedOn && !isPlausiblePublishedDate(firstPublishedOn, nowMs))) {
    return { isError: true, message: 'firstPublishedOn must be a date (YYYY-MM-DD) that is not in the future' };
  }
  if (ownershipNote === 'invalid' || (ownershipNote && ownershipNote.length > MAX_OWNERSHIP_NOTE_LENGTH)) {
    return { isError: true, message: `ownershipNote must be text of at most ${MAX_OWNERSHIP_NOTE_LENGTH} characters` };
  }
  return { isError: false, proofInput: { firstPublishedUrl, firstPublishedOn, ownershipNote } };
}
