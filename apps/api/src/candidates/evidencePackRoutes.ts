import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { JobQueuesInstance } from '../queues/jobQueues.js';
import type { ObjectStorageInstance } from '../storage/objectStorage.js';
import { clearEvidenceError, findEvidencePackState, updateNoticeText, type EvidencePackStateDetails } from './evidencePackRepository.js';

const MAX_NOTICE_LENGTH = 20_000;
const PLACEHOLDER_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

export interface EvidencePackRouteDependencies {
  pool: pg.Pool;
  objectStorage: ObjectStorageInstance;
  jobQueues: JobQueuesInstance;
}

type PackLookupResult = { isError: false; candidateId: number; packState: EvidencePackStateDetails } | { isError: true; statusCode: number; message: string };

// Shared preamble: the candidate must exist, belong to this creator, and be approved (the only path to a pack)
async function lookUpApprovedPack(pool: pg.Pool, request: FastifyRequest): Promise<PackLookupResult> {
  const candidateId = Number((request.params as { candidateId?: string }).candidateId);
  const creatorId = request.reviewer?.creatorId ?? 0;
  const packState = Number.isInteger(candidateId) && candidateId > 0 ? await findEvidencePackState(pool, creatorId, candidateId) : undefined;
  if (!packState) return { isError: true, statusCode: 404, message: 'Candidate not found' };
  if (packState.status !== 'approved') return { isError: true, statusCode: 404, message: 'Only approved candidates have an evidence pack' };
  return { isError: false, candidateId, packState };
}

// 200 with the ZIP; 202 while it is being built (re-enqueued idempotently); 409 with what the creator must fix
async function sendPack(routeDependencies: EvidencePackRouteDependencies, request: FastifyRequest, reply: FastifyReply) {
  const lookupResult = await lookUpApprovedPack(routeDependencies.pool, request);
  if (lookupResult.isError) return reply.code(lookupResult.statusCode).send({ isError: true, message: lookupResult.message });
  const { candidateId, packState } = lookupResult;
  if (packState.evidenceError) return reply.code(409).send({ isError: true, message: packState.evidenceError });
  const storedZip = packState.zipKey ? await routeDependencies.objectStorage.getObject(packState.zipKey) : undefined;
  if (!storedZip) {
    await routeDependencies.jobQueues.enqueueEvidence(candidateId);
    return reply.code(202).send({ status: 'generating', message: 'The evidence pack is being built. Try again in a few seconds.' });
  }
  reply.type('application/zip').header('content-disposition', `attachment; filename="repost-radar-candidate-${candidateId}.zip"`);
  if (storedZip.contentLength) reply.header('content-length', storedZip.contentLength);
  return reply.send(storedZip.bodyStream);
}

async function regeneratePack(routeDependencies: EvidencePackRouteDependencies, request: FastifyRequest, reply: FastifyReply) {
  const lookupResult = await lookUpApprovedPack(routeDependencies.pool, request);
  if (lookupResult.isError) return reply.code(lookupResult.statusCode).send({ isError: true, message: lookupResult.message });
  await clearEvidenceError(routeDependencies.pool, lookupResult.candidateId);
  await routeDependencies.jobQueues.enqueueEvidence(lookupResult.candidateId, true);
  return reply.code(202).send({ status: 'generating', message: 'Rebuilding the evidence pack. Edits to the notice will be replaced.' });
}

export function parseNoticeText(rawBody: unknown): { isError: false; noticeText: string } | { isError: true; message: string } {
  const noticeText = (rawBody as { noticeText?: unknown } | undefined)?.noticeText;
  if (typeof noticeText !== 'string' || !noticeText.trim() || noticeText.length > MAX_NOTICE_LENGTH) {
    return { isError: true, message: `noticeText is required (≤ ${MAX_NOTICE_LENGTH} characters)` };
  }
  // Edits may not reintroduce placeholders: an exported notice is always fully resolved
  const placeholderNameList = [...new Set([...noticeText.matchAll(PLACEHOLDER_PATTERN)].map((placeholderMatch) => placeholderMatch[1] ?? ''))];
  if (placeholderNameList.length) {
    return { isError: true, message: `The notice still contains placeholder(s): ${placeholderNameList.map((name) => `{{${name}}}`).join(', ')}` };
  }
  return { isError: false, noticeText: noticeText.trim() };
}

export function registerEvidencePackRoutes(server: FastifyInstance, routeDependencies: EvidencePackRouteDependencies): void {
  server.get('/candidates/:candidateId/pack', async (request, reply) => sendPack(routeDependencies, request, reply));
  server.post('/candidates/:candidateId/pack', async (request, reply) => regeneratePack(routeDependencies, request, reply));

  server.get('/candidates/:candidateId/notice', async (request, reply) => {
    const lookupResult = await lookUpApprovedPack(routeDependencies.pool, request);
    if (lookupResult.isError) return reply.code(lookupResult.statusCode).send({ isError: true, message: lookupResult.message });
    const { noticeText, templateId, generatedAt, evidenceError } = lookupResult.packState;
    if (!noticeText) return reply.code(evidenceError ? 409 : 202).send({ isError: Boolean(evidenceError), message: evidenceError ?? 'The notice is being generated' });
    return { noticeText, templateId, generatedAt };
  });

  server.put('/candidates/:candidateId/notice', async (request, reply) => {
    const lookupResult = await lookUpApprovedPack(routeDependencies.pool, request);
    if (lookupResult.isError) return reply.code(lookupResult.statusCode).send({ isError: true, message: lookupResult.message });
    const parseResult = parseNoticeText(request.body);
    if (parseResult.isError) return reply.code(400).send(parseResult);
    if (!(await updateNoticeText(routeDependencies.pool, lookupResult.candidateId, parseResult.noticeText))) {
      return reply.code(409).send({ isError: true, message: 'There is no generated notice to edit yet' });
    }
    return { noticeText: parseResult.noticeText };
  });
}
