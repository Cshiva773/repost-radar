import { describe, expect, it } from 'vitest';
import { buildOriginalStorageKey, detectImageMimeType } from './imageValidation.js';

const PADDING = Buffer.alloc(16);

describe('detectImageMimeType', () => {
  it('detects JPEG from its SOI marker', () => {
    expect(detectImageMimeType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), PADDING]))).toBe('image/jpeg');
  });

  it('detects PNG from its 8-byte signature', () => {
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectImageMimeType(Buffer.concat([pngSignature, PADDING]))).toBe('image/png');
  });

  it('detects WebP inside a RIFF container', () => {
    const webpHeader = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
    expect(detectImageMimeType(Buffer.concat([webpHeader, PADDING]))).toBe('image/webp');
  });

  it('rejects a GIF and a too-short buffer', () => {
    expect(detectImageMimeType(Buffer.concat([Buffer.from('GIF89a'), PADDING]))).toBeUndefined();
    expect(detectImageMimeType(Buffer.from([0xff, 0xd8]))).toBeUndefined();
  });
});

describe('buildOriginalStorageKey', () => {
  it('namespaces by creator and content hash', () => {
    expect(buildOriginalStorageKey(1, 'abc123', 'image/png')).toBe('originals/1/abc123.png');
  });
});
