import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { registerAsset, type AssetServiceDependencies } from './assetService.js';

const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const INSERTED_ROW = {
  assetId: '42', creatorId: '1', sha256: 'x', storageKey: 'k', mimeType: 'image/jpeg', isFingerprinted: false, createdAt: 'now',
};

function buildFakeDependencies(existingAssetId?: number) {
  const queryMock = vi.fn(async (sqlText: string) => {
    if (sqlText.startsWith('SELECT id FROM assets')) return { rows: existingAssetId ? [{ id: String(existingAssetId) }] : [] };
    if (sqlText.startsWith('INSERT INTO assets')) return { rows: [INSERTED_ROW] };
    return { rows: [] };
  });
  const serviceDependencies: AssetServiceDependencies = {
    pool: { query: queryMock } as unknown as pg.Pool,
    objectStorage: { putObject: vi.fn(async () => undefined) },
    jobQueues: { enqueueFingerprint: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
  };
  return serviceDependencies;
}

describe('registerAsset', () => {
  it('rejects bytes that are not a supported image', async () => {
    const registerResult = await registerAsset(buildFakeDependencies(), 1, Buffer.from('GIF89a-not-supported'));
    expect(registerResult).toMatchObject({ isError: true, errorKind: 'unsupported-type' });
  });

  it('stores, inserts and enqueues a new image', async () => {
    const serviceDependencies = buildFakeDependencies();
    const registerResult = await registerAsset(serviceDependencies, 1, JPEG_BYTES);
    expect(registerResult).toMatchObject({ isError: false, assetDetails: { assetId: 42 } });
    expect(serviceDependencies.objectStorage.putObject).toHaveBeenCalledOnce();
    expect(serviceDependencies.jobQueues.enqueueFingerprint).toHaveBeenCalledWith(42);
  });

  it('returns the existing id for a duplicate without uploading again', async () => {
    const serviceDependencies = buildFakeDependencies(7);
    const registerResult = await registerAsset(serviceDependencies, 1, JPEG_BYTES);
    expect(registerResult).toMatchObject({ isError: true, errorKind: 'duplicate', existingAssetId: 7 });
    expect(serviceDependencies.objectStorage.putObject).not.toHaveBeenCalled();
  });
});
