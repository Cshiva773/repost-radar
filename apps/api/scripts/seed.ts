// `pnpm seed`: registers the 20 CC0 images in eval/seed/manifest.json through POST /assets,
// then waits until every one is fingerprinted. Images are cached in data/seed-cache.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApiClient, loadRepoEnv, REPO_ROOT, type ApiClientInstance } from './apiClient.js';

loadRepoEnv();
const MANIFEST_PATH = join(REPO_ROOT, 'eval', 'seed', 'manifest.json');
const CACHE_DIRECTORY = join(REPO_ROOT, 'data', 'seed-cache');
const API_URL = process.env.API_URL ?? 'http://localhost:8080';
const USER_AGENT = 'repost-radar/0.1 (https://github.com/Cshiva773/repost-radar; seed script)';
const FINGERPRINT_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;

interface SeedImageDetails {
  seedId: string;
  title: string;
  downloadUrl: string;
}

async function readCachedOrDownload(seedImage: SeedImageDetails): Promise<Buffer> {
  const cachePath = join(CACHE_DIRECTORY, `${seedImage.seedId}.jpg`);
  if (existsSync(cachePath)) return readFile(cachePath);
  const downloadResponse = await fetch(seedImage.downloadUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!downloadResponse.ok) throw new Error(`download ${seedImage.seedId} failed: HTTP ${downloadResponse.status}`);
  const imageBuffer = Buffer.from(await downloadResponse.arrayBuffer());
  await writeFile(cachePath, imageBuffer);
  return imageBuffer;
}

async function uploadSeedImage(apiClient: ApiClientInstance, seedImage: SeedImageDetails, imageBuffer: Buffer): Promise<number> {
  const uploadForm = new FormData();
  uploadForm.append('file', new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }), `${seedImage.seedId}.jpg`);
  const uploadResponse = await apiClient.request('/assets', { method: 'POST', body: uploadForm });
  const uploadBody = (await uploadResponse.json()) as { assetId?: number; existingAssetId?: number; message?: string };
  if (uploadResponse.status === 202 && uploadBody.assetId) return uploadBody.assetId;
  if (uploadResponse.status === 409 && uploadBody.existingAssetId) return uploadBody.existingAssetId;
  throw new Error(`upload ${seedImage.seedId} failed: HTTP ${uploadResponse.status} ${uploadBody.message ?? ''}`);
}

async function countFingerprinted(apiClient: ApiClientInstance, assetIdList: number[]): Promise<number> {
  const listResponse = await apiClient.request('/assets?pageSize=200');
  const listBody = (await listResponse.json()) as { assetList: { assetId: number; isFingerprinted: boolean }[] };
  const wantedIdSet = new Set(assetIdList);
  return listBody.assetList.filter((asset) => wantedIdSet.has(asset.assetId) && asset.isFingerprinted).length;
}

async function waitForFingerprints(apiClient: ApiClientInstance, assetIdList: number[]): Promise<void> {
  const deadline = Date.now() + FINGERPRINT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const fingerprintedCount = await countFingerprinted(apiClient, assetIdList);
    console.log(`Step 3: ${fingerprintedCount}/${assetIdList.length} fingerprinted`);
    if (fingerprintedCount === assetIdList.length) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`timed out after ${FINGERPRINT_TIMEOUT_MS / 1000}s waiting for fingerprints`);
}

async function seed(): Promise<void> {
  const startedAt = Date.now();
  const seedImageList = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as SeedImageDetails[];
  await mkdir(CACHE_DIRECTORY, { recursive: true });
  const apiClient = await createApiClient(API_URL);
  const assetIdList: number[] = [];
  for (const seedImage of seedImageList) {
    const assetId = await uploadSeedImage(apiClient, seedImage, await readCachedOrDownload(seedImage));
    assetIdList.push(assetId);
    console.log(`Step 1: ${seedImage.seedId} -> asset ${assetId} (${seedImage.title})`);
  }
  console.log(`Step 2: ${assetIdList.length} images registered`);
  await waitForFingerprints(apiClient, assetIdList);
  console.log(`Step 4: seed complete in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

seed().catch((error) => {
  console.error('Seed failed', error);
  process.exit(1);
});
