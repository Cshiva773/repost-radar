import type { FastifyInstance } from 'fastify';
import { findAssetById, listAssets } from './assetRepository.js';
import { registerAsset, type AssetServiceDependencies } from './assetService.js';

const DEFAULT_CREATOR_ID = 1;
const MAX_PAGE_SIZE = 200;
const STATUS_BY_ERROR_KIND = { 'unsupported-type': 415, duplicate: 409, failed: 500 } as const;

function parsePositiveInteger(rawValue: unknown, fallbackValue: number): number {
  const parsedValue = Number(rawValue);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallbackValue;
}

export function registerAssetRoutes(server: FastifyInstance, serviceDependencies: AssetServiceDependencies): void {
  server.post('/assets', async (request, reply) => {
    const uploadedFile = await request.file();
    if (!uploadedFile) return reply.code(400).send({ isError: true, message: 'Attach the image as a multipart "file" field' });
    const creatorField = uploadedFile.fields.creatorId as { value?: unknown } | undefined;
    const creatorId = parsePositiveInteger(creatorField?.value, DEFAULT_CREATOR_ID);

    const registerResult = await registerAsset(serviceDependencies, creatorId, await uploadedFile.toBuffer());
    if (registerResult.isError) {
      const { errorKind, message, existingAssetId } = registerResult;
      return reply.code(STATUS_BY_ERROR_KIND[errorKind]).send({ isError: true, message, existingAssetId });
    }
    return reply.code(202).send({ ...registerResult.assetDetails, status: 'queued' });
  });

  server.get('/assets', async (request) => {
    const queryDetails = request.query as { pageSize?: string; pageOffset?: string };
    const pageSize = Math.min(parsePositiveInteger(queryDetails.pageSize, 50), MAX_PAGE_SIZE);
    const pageOffset = Math.max(0, Number(queryDetails.pageOffset) || 0);
    const assetList = await listAssets(serviceDependencies.pool, pageSize, pageOffset);
    return { assetList, assetCount: assetList.length };
  });

  server.get('/assets/:assetId', async (request, reply) => {
    const assetId = parsePositiveInteger((request.params as { assetId: string }).assetId, 0);
    const assetDetails = assetId ? await findAssetById(serviceDependencies.pool, assetId) : undefined;
    if (!assetDetails) return reply.code(404).send({ isError: true, message: 'Asset not found' });
    return assetDetails;
  });
}
