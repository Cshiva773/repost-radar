import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { JobQueuesInstance } from '../queues/jobQueues.js';
import type { ObjectStorageInstance } from '../storage/objectStorage.js';
import { findAssetIdBySha256, insertAsset, type AssetDetails } from './assetRepository.js';
import { buildOriginalStorageKey, detectImageMimeType } from './imageValidation.js';

export interface AssetServiceDependencies {
  pool: pg.Pool;
  objectStorage: ObjectStorageInstance;
  jobQueues: JobQueuesInstance;
}

export type RegisterAssetResult =
  | { isError: false; assetDetails: AssetDetails }
  | { isError: true; errorKind: 'unsupported-type' | 'duplicate' | 'failed'; message: string; existingAssetId?: number };

const UNSUPPORTED_TYPE_MESSAGE = 'Only JPEG, PNG and WebP images are supported';
const DUPLICATE_MESSAGE = 'This image is already registered';
const GENERIC_ERROR_MESSAGE = 'Something went wrong';

async function duplicateResult(serviceDependencies: AssetServiceDependencies, creatorId: number, sha256: string): Promise<RegisterAssetResult> {
  const existingAssetId = await findAssetIdBySha256(serviceDependencies.pool, creatorId, sha256);
  return { isError: true, errorKind: 'duplicate', message: DUPLICATE_MESSAGE, existingAssetId };
}

export async function registerAsset(
  serviceDependencies: AssetServiceDependencies,
  creatorId: number,
  fileBuffer: Buffer,
): Promise<RegisterAssetResult> {
  const mimeType = detectImageMimeType(fileBuffer);
  if (!mimeType) return { isError: true, errorKind: 'unsupported-type', message: UNSUPPORTED_TYPE_MESSAGE };

  const sha256 = createHash('sha256').update(fileBuffer).digest('hex');
  if (await findAssetIdBySha256(serviceDependencies.pool, creatorId, sha256)) return duplicateResult(serviceDependencies, creatorId, sha256);

  try {
    const storageKey = buildOriginalStorageKey(creatorId, sha256, mimeType);
    await serviceDependencies.objectStorage.putObject(storageKey, fileBuffer, mimeType);
    const assetDetails = await insertAsset(serviceDependencies.pool, { creatorId, sha256, storageKey, mimeType });
    if (!assetDetails) return duplicateResult(serviceDependencies, creatorId, sha256);
    await serviceDependencies.jobQueues.enqueueFingerprint(assetDetails.assetId);
    return { isError: false, assetDetails };
  } catch (error) {
    console.error('registerAsset failed', error);
    return { isError: true, errorKind: 'failed', message: GENERIC_ERROR_MESSAGE };
  }
}
