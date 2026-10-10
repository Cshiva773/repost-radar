import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ReviewerDetails } from '../auth/authRepository.js';
import { findCreatorProfile } from '../creator/creatorRoutes.js';
import type { JobQueuesInstance } from '../queues/jobQueues.js';
import type { ObjectStorageInstance } from '../storage/objectStorage.js';
import { countCandidates, findCandidate, findImageStorageKey, listCandidates, type ImageRole } from './candidateRepository.js';
import { parseCandidateFilters, parseDecisionBody } from './candidateRules.js';
import { recordDecision } from './decisionService.js';

const IMAGE_ROLE_LIST: ImageRole[] = ['original', 'candidate'];
const IMAGE_CACHE_CONTROL = 'private, max-age=3600';
const GENERIC_ERROR_MESSAGE = 'Something went wrong';
const PROFILE_INCOMPLETE_MESSAGE = 'Add your legal name, contact email and mailing address in Settings before approving: the notice needs them.';

export interface CandidateRouteDependencies {
  pool: pg.Pool;
  objectStorage: ObjectStorageInstance;
  jobQueues: JobQueuesInstance;
}

function parseCandidateId(rawParams: unknown): number {
  const candidateId = Number((rawParams as { candidateId?: string }).candidateId);
  return Number.isInteger(candidateId) && candidateId > 0 ? candidateId : 0;
}

// The auth guard runs first on every non-public route, so a reviewer is always present here
function readReviewer(request: FastifyRequest): ReviewerDetails {
  if (!request.reviewer) throw new Error('Route reached without a reviewer');
  return request.reviewer;
}

// Images stream through the API behind the session, so object storage never has to be reachable from a browser
async function sendCandidateImage(routeDependencies: CandidateRouteDependencies, request: FastifyRequest, reply: FastifyReply) {
  const candidateId = parseCandidateId(request.params);
  const imageRole = (request.params as { imageRole?: string }).imageRole as ImageRole;
  if (!candidateId || !IMAGE_ROLE_LIST.includes(imageRole)) return reply.code(404).send({ isError: true, message: 'Image not found' });
  const storedImage = await findImageStorageKey(routeDependencies.pool, readReviewer(request).creatorId, candidateId, imageRole);
  const storedObject = storedImage?.storageKey ? await routeDependencies.objectStorage.getObject(storedImage.storageKey) : undefined;
  if (!storedObject) return reply.code(404).send({ isError: true, message: 'Image is no longer stored' });
  reply.header('cache-control', IMAGE_CACHE_CONTROL).type(storedObject.contentType ?? 'application/octet-stream');
  if (storedObject.contentLength) reply.header('content-length', storedObject.contentLength);
  return reply.send(storedObject.bodyStream);
}

async function handleDecision(routeDependencies: CandidateRouteDependencies, request: FastifyRequest, reply: FastifyReply) {
  const candidateId = parseCandidateId(request.params);
  if (!candidateId) return reply.code(404).send({ isError: true, message: 'Candidate not found' });
  const parseResult = parseDecisionBody(request.body);
  if (parseResult.isError) return reply.code(400).send(parseResult);
  const reviewer = readReviewer(request);
  if (parseResult.decisionInput.action === 'approve' && !(await findCreatorProfile(routeDependencies.pool, reviewer.creatorId))?.isNoticeReady) {
    return reply.code(422).send({ isError: true, message: PROFILE_INCOMPLETE_MESSAGE });
  }
  const decisionResult = await recordDecision(routeDependencies.pool, reviewer, candidateId, parseResult.decisionInput);
  if (!decisionResult) return reply.code(500).send({ isError: true, message: GENERIC_ERROR_MESSAGE });
  if (decisionResult.isError) return reply.code(decisionResult.statusCode).send({ isError: true, message: decisionResult.message });
  request.log.info({ candidateId, actor: reviewer.username, toStatus: decisionResult.toStatus, cascadedCount: decisionResult.cascadedCount }, 'Decision recorded');
  // After commit: if this enqueue is lost, the startup sweep (listApprovedWithoutPack) re-enqueues it
  if (decisionResult.toStatus === 'approved') await routeDependencies.jobQueues.enqueueEvidence(candidateId);
  return findCandidate(routeDependencies.pool, reviewer.creatorId, candidateId);
}

export function registerCandidateRoutes(server: FastifyInstance, routeDependencies: CandidateRouteDependencies): void {
  const { pool } = routeDependencies;

  server.get('/candidates', async (request, reply) => {
    const parseResult = parseCandidateFilters(request.query);
    if (parseResult.isError) return reply.code(400).send(parseResult);
    const { creatorId } = readReviewer(request);
    const { filterDetails } = parseResult;
    const [candidateList, totalCount] = await Promise.all([listCandidates(pool, creatorId, filterDetails), countCandidates(pool, creatorId, filterDetails)]);
    return { candidateList, candidateCount: candidateList.length, totalCount, pageSize: filterDetails.pageSize, pageOffset: filterDetails.pageOffset };
  });

  server.get('/candidates/:candidateId', async (request, reply) => {
    const candidateId = parseCandidateId(request.params);
    const candidateDetails = candidateId ? await findCandidate(pool, readReviewer(request).creatorId, candidateId) : undefined;
    if (!candidateDetails) return reply.code(404).send({ isError: true, message: 'Candidate not found' });
    return candidateDetails;
  });

  server.get('/candidates/:candidateId/images/:imageRole', async (request, reply) => sendCandidateImage(routeDependencies, request, reply));
  server.post('/candidates/:candidateId/decision', async (request, reply) => handleDecision(routeDependencies, request, reply));
}
