export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type SupportedMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

const FILE_EXTENSION_BY_MIME: Record<SupportedMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Sniff the real type from magic bytes; the client's Content-Type is not trusted
export function detectImageMimeType(fileBuffer: Buffer): SupportedMimeType | undefined {
  if (fileBuffer.length < 12) return undefined;
  if (fileBuffer[0] === 0xff && fileBuffer[1] === 0xd8 && fileBuffer[2] === 0xff) return 'image/jpeg';
  if (fileBuffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  const isRiffContainer = fileBuffer.subarray(0, 4).toString('ascii') === 'RIFF';
  if (isRiffContainer && fileBuffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return undefined;
}

export function fileExtensionFor(mimeType: SupportedMimeType): string {
  return FILE_EXTENSION_BY_MIME[mimeType];
}

export function buildOriginalStorageKey(creatorId: number, sha256Hex: string, mimeType: SupportedMimeType): string {
  return `originals/${creatorId}/${sha256Hex}.${fileExtensionFor(mimeType)}`;
}
