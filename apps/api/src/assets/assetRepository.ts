import type pg from 'pg';
import type { SupportedMimeType } from './imageValidation.js';

export interface AssetDetails {
  assetId: number;
  creatorId: number;
  sha256: string;
  storageKey: string;
  mimeType: string;
  isFingerprinted: boolean;
  createdAt: string;
}

export interface NewAssetDetails {
  creatorId: number;
  sha256: string;
  storageKey: string;
  mimeType: SupportedMimeType;
}

const ASSET_COLUMNS_SQL = `id AS "assetId", creator_id AS "creatorId", sha256, storage_key AS "storageKey",
  mime_type AS "mimeType", fingerprinted_at IS NOT NULL AS "isFingerprinted", created_at AS "createdAt"`;

function toAssetDetails(assetRow: AssetDetails): AssetDetails {
  return { ...assetRow, assetId: Number(assetRow.assetId), creatorId: Number(assetRow.creatorId) };
}

export async function findAssetIdBySha256(pool: pg.Pool, creatorId: number, sha256: string): Promise<number | undefined> {
  try {
    const queryResult = await pool.query<{ id: string }>('SELECT id FROM assets WHERE creator_id = $1 AND sha256 = $2', [creatorId, sha256]);
    return queryResult.rows[0] ? Number(queryResult.rows[0].id) : undefined;
  } catch (error) {
    console.error('findAssetIdBySha256 failed', error);
    return undefined;
  }
}

// Returns the new asset, or undefined when the (creator, sha256) pair already exists or the insert fails
export async function insertAsset(pool: pg.Pool, newAssetDetails: NewAssetDetails): Promise<AssetDetails | undefined> {
  try {
    const queryResult = await pool.query<AssetDetails>(
      `INSERT INTO assets (creator_id, sha256, storage_key, mime_type) VALUES ($1, $2, $3, $4)
       ON CONFLICT (creator_id, sha256) DO NOTHING RETURNING ${ASSET_COLUMNS_SQL}`,
      [newAssetDetails.creatorId, newAssetDetails.sha256, newAssetDetails.storageKey, newAssetDetails.mimeType],
    );
    return queryResult.rows[0] ? toAssetDetails(queryResult.rows[0]) : undefined;
  } catch (error) {
    console.error('insertAsset failed', error);
    return undefined;
  }
}

export async function findAssetById(pool: pg.Pool, creatorId: number, assetId: number): Promise<AssetDetails | undefined> {
  try {
    const queryResult = await pool.query<AssetDetails>(`SELECT ${ASSET_COLUMNS_SQL} FROM assets WHERE creator_id = $1 AND id = $2`, [creatorId, assetId]);
    return queryResult.rows[0] ? toAssetDetails(queryResult.rows[0]) : undefined;
  } catch (error) {
    console.error('findAssetById failed', error);
    return undefined;
  }
}

// Newest first, so a fresh upload shows at the top of the originals page
export async function listAssets(pool: pg.Pool, creatorId: number, pageSize: number, pageOffset: number): Promise<AssetDetails[]> {
  try {
    const queryResult = await pool.query<AssetDetails>(
      `SELECT ${ASSET_COLUMNS_SQL} FROM assets WHERE creator_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3`,
      [creatorId, pageSize, pageOffset],
    );
    return queryResult.rows.map(toAssetDetails);
  } catch (error) {
    console.error('listAssets failed', error);
    return [];
  }
}

export async function countAssets(pool: pg.Pool, creatorId: number): Promise<number> {
  try {
    const queryResult = await pool.query<{ total: string }>('SELECT count(*) AS total FROM assets WHERE creator_id = $1', [creatorId]);
    return Number(queryResult.rows[0]?.total ?? 0);
  } catch (error) {
    console.error('countAssets failed', error);
    return 0;
  }
}
