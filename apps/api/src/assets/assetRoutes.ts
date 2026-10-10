import type { FastifyInstance, FastifyRequest } from 'fastify';
import { countAssets, findAssetById, listAssets } from './assetRepository.js';
import { registerAsset, type AssetServiceDependencies } from './assetService.js';

const MAX_PAGE_SIZE = 200;
const IMAGE_CACHE_CONTROL = 'private, max-age=3600';
const STATUS_BY_ERROR_KIND = { 'unsupported-type': 415, duplicate: 409, failed: 500 } as const;

function parsePositiveInteger(rawValue: unknown, fallbackValue: number): number {
  const parsedValue = Number(rawValue);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallbackValue;
}

// The creator always comes from the session, never from the request, so nobody can upload into another bank
function readCreatorId(request: FastifyRequest): number {
  if (!request.reviewer) throw new Error('Route reached without a reviewer');
  return request.reviewer.creatorId;
}

export function registerAssetRoutes(server: FastifyInstance, serviceDependencies: AssetServiceDependencies): void {
  server.post('/assets', async (request, reply) => {
    const uploadedFile = await request.file();
    if (!uploadedFile) return reply.code(400).send({ isError: true, message: 'Attach the image as a multipart "file" field' });
    const registerResult = await registerAsset(serviceDependencies, readCreatorId(request), await uploadedFile.toBuffer());
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
    const creatorId = readCreatorId(request);
    const [assetList, totalCount] = await Promise.all([listAssets(serviceDependencies.pool, creatorId, pageSize, pageOffset), countAssets(serviceDependencies.pool, creatorId)]);
    return { assetList, assetCount: assetList.length, totalCount };
  });

  server.get('/assets/:assetId', async (request, reply) => {
    const assetId = parsePositiveInteger((request.params as { assetId: string }).assetId, 0);
    const assetDetails = assetId ? await findAssetById(serviceDependencies.pool, readCreatorId(request), assetId) : undefined;
    if (!assetDetails) return reply.code(404).send({ isError: true, message: 'Asset not found' });
    return assetDetails;
  });

  server.get('/assets/:assetId/image', async (request, reply) => {
    const assetId = parsePositiveInteger((request.params as { assetId: string }).assetId, 0);
    const assetDetails = assetId ? await findAssetById(serviceDependencies.pool, readCreatorId(request), assetId) : undefined;
    const storedObject = assetDetails ? await serviceDependencies.objectStorage.getObject(assetDetails.storageKey) : undefined;
    if (!storedObject) return reply.code(404).send({ isError: true, message: 'Image not found' });
    reply.header('cache-control', IMAGE_CACHE_CONTROL).type(storedObject.contentType ?? assetDetails?.mimeType ?? 'application/octet-stream');
    return reply.send(storedObject.bodyStream);
  });
}
