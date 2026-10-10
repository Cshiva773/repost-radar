import { findPlatformDefinition } from '@repost-radar/platforms';

/**
 * Every placeholder a notice template may use. The evidence worker fills them
 * (workers/fingerprint/src/fingerprint_worker/notice.py, NOTICE_PLACEHOLDER_NAMES) and refuses to
 * build a notice while any is empty; a test there keeps the two lists identical.
 */
export const NOTICE_PLACEHOLDER_LIST = [
  { name: 'infringing_url', description: 'Link to the post that copies your image' },
  { name: 'post_author', description: 'Handle of the account that posted it' },
  { name: 'post_title', description: 'Post title (Reddit only; Bluesky posts have none)' },
  { name: 'target_name', description: 'Where it was found: subreddit, hashtag or account' },
  { name: 'posted_at', description: 'When the copy was posted (UTC)' },
  { name: 'platform_name', description: 'Platform display name, e.g. Reddit' },
  { name: 'original_sha256', description: 'SHA-256 of your original file' },
  { name: 'original_extension', description: 'File extension of the attached original (jpg, png, webp)' },
  { name: 'creator_name', description: 'Your display name' },
  { name: 'legal_name', description: 'Your full legal name, used as the signature' },
  { name: 'mailing_address', description: 'Your postal address' },
  { name: 'contact_email', description: 'Your contact email' },
  { name: 'candidate_id', description: 'Repost Radar candidate number' },
  { name: 'confidence', description: 'Match confidence, 0 to 1' },
  { name: 'detected_at', description: 'When Repost Radar found the match (UTC)' },
  { name: 'today', description: "The date the pack was generated (UTC)" },
] as const;

const PLACEHOLDER_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;
const KNOWN_PLACEHOLDER_SET = new Set<string>(NOTICE_PLACEHOLDER_LIST.map((placeholder) => placeholder.name));
const MAX_NAME_LENGTH = 120;
const MAX_SUBJECT_LENGTH = 300;
const MAX_BODY_LENGTH = 20_000;

export interface NoticeTemplateInputDetails {
  platform: string;
  name: string;
  subject: string;
  body: string;
}

export type TemplateParseResult = { isError: false; templateInput: NoticeTemplateInputDetails } | { isError: true; message: string };

export function findUnknownPlaceholders(templateText: string): string[] {
  const placeholderNameList = [...templateText.matchAll(PLACEHOLDER_PATTERN)].map((placeholderMatch) => placeholderMatch[1] ?? '');
  return [...new Set(placeholderNameList.filter((placeholderName) => !KNOWN_PLACEHOLDER_SET.has(placeholderName)))];
}

function readTextField(rawValue: unknown, maxLength: number): string | undefined {
  if (typeof rawValue !== 'string') return undefined;
  const trimmedValue = rawValue.trim();
  return trimmedValue && trimmedValue.length <= maxLength ? trimmedValue : undefined;
}

// Unknown placeholders are rejected on save, so a typo surfaces in the editor rather than at approval time
export function parseTemplateBody(rawBody: unknown): TemplateParseResult {
  const bodyDetails = (rawBody ?? {}) as Record<string, unknown>;
  const platform = typeof bodyDetails.platform === 'string' ? bodyDetails.platform.trim().toLowerCase() : '';
  if (!findPlatformDefinition(platform)) return { isError: true, message: `Unknown platform "${platform}"` };
  const name = readTextField(bodyDetails.name, MAX_NAME_LENGTH);
  const subject = readTextField(bodyDetails.subject, MAX_SUBJECT_LENGTH);
  const body = readTextField(bodyDetails.body, MAX_BODY_LENGTH);
  if (!name || !subject || !body) {
    return { isError: true, message: `name (≤ ${MAX_NAME_LENGTH}), subject (≤ ${MAX_SUBJECT_LENGTH}) and body (≤ ${MAX_BODY_LENGTH}) are required` };
  }
  const unknownPlaceholderList = findUnknownPlaceholders(`${subject}\n${body}`);
  if (unknownPlaceholderList.length) return { isError: true, message: `Unknown placeholder(s): ${unknownPlaceholderList.map((placeholderName) => `{{${placeholderName}}}`).join(', ')}` };
  return { isError: false, templateInput: { platform, name, subject, body } };
}
