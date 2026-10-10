import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { detectImageMimeType } from '../assets/imageValidation.js';
import type { JobQueuesInstance } from '../queues/jobQueues.js';
import type { ObjectStorageInstance } from '../storage/objectStorage.js';

// CLIP on CPU takes a second or two; a cold worker loading the model needs longer
const CHECK_TIMEOUT_MS = 30_000;
const CHECK_STORAGE_PREFIX = 'checks';

export interface CheckRouteDependencies {
  objectStorage: ObjectStorageInstance;
  jobQueues: JobQueuesInstance;
}

/**
 * POST /checks: "is this image one of mine?" for the browser extension. The image is stored only for
 * the duration of the check and deleted afterwards; nothing about it is kept.
 */
async function handleCheck(routeDependencies: CheckRouteDependencies, request: FastifyRequest, reply: FastifyReply) {
  const uploadedFile = await request.file();
  if (!uploadedFile) return reply.code(400).send({ isError: true, message: 'Attach the image as a multipart "file" field' });
  const imageBuffer = await uploadedFile.toBuffer();
  const mimeType = detectImageMimeType(imageBuffer);
  if (!mimeType) return reply.code(415).send({ isError: true, message: 'Only JPEG, PNG and WebP images are supported' });
  const storageKey = `${CHECK_STORAGE_PREFIX}/${randomUUID()}`;
  await routeDependencies.objectStorage.putObject(storageKey, imageBuffer, mimeType);
  try {
    const creatorId = request.reviewer?.creatorId ?? 0;
    const checkResult = await routeDependencies.jobQueues.runCheck(storageKey, creatorId, CHECK_TIMEOUT_MS);
    return {
      ...checkResult,
      matchList: checkResult.matchList.map((checkMatch) => ({ ...checkMatch, imagePath: `/assets/${checkMatch.assetId}/image` })),
    };
  } catch (error) {
    request.log.warn({ err: error }, 'Image check did not finish');
    return reply.code(504).send({ isError: true, message: 'The check took too long. Is the fingerprint worker running?' });
  } finally {
    await routeDependencies.objectStorage.deleteObject(storageKey).catch((error: unknown) => request.log.warn({ err: error, storageKey }, 'Could not delete checked image'));
  }
}

export function registerCheckRoutes(server: FastifyInstance, routeDependencies: CheckRouteDependencies): void {
  server.post('/checks', async (request, reply) => handleCheck(routeDependencies, request, reply));
}
