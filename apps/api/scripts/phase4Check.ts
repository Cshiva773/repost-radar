// Phase 4 API check, run after the phase 2 gate has planted copies (scripts/phase4-gate.sh).
// Exercises auth, the queue, images, every decision path and template validation against the real stack.
import { createApiClient, loadRepoEnv, type ApiClientInstance } from './apiClient.js';

loadRepoEnv();
const API_URL = process.env.API_URL ?? 'http://localhost:8080';
const PACK_TIMEOUT_MS = 90_000;
const PACK_POLL_MS = 2_000;
const NOTICE_PROFILE = { name: 'Demo creator', legalName: 'Dana Example', contactEmail: 'dana@example.com', mailingAddress: '1 Example Street, Springfield' };

interface CandidateSummary {
  candidateId: number;
  status: string;
  decisionList?: { actor: string; fromStatus: string; toStatus: string }[];
}

const failureList: string[] = [];

function check(stepLabel: string, isPassing: boolean, detailText = ''): void {
  console.log(`${isPassing ? 'PASS' : 'FAIL'}  ${stepLabel}${detailText ? `  (${detailText})` : ''}`);
  if (!isPassing) failureList.push(stepLabel);
}

async function sendJson(apiClient: ApiClientInstance, requestPath: string, method: string, requestBody: unknown): Promise<Response> {
  return apiClient.request(requestPath, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody) });
}

async function decide(apiClient: ApiClientInstance, candidateId: number, decisionBody: Record<string, unknown>): Promise<Response> {
  return sendJson(apiClient, `/candidates/${candidateId}/decision`, 'POST', decisionBody);
}

async function checkQueueAndImages(apiClient: ApiClientInstance): Promise<CandidateSummary[]> {
  check('Step 1: unauthenticated /candidates is refused', (await fetch(`${API_URL}/candidates`)).status === 401);
  const queueBody = await (await apiClient.request('/candidates?status=pending&pageSize=10')).json() as { candidateList: CandidateSummary[]; totalCount: number };
  check('Step 2: queue lists the planted copies', queueBody.totalCount >= 3, `${queueBody.totalCount} pending`);
  const firstCandidate = queueBody.candidateList[0];
  for (const imageRole of ['original', 'candidate']) {
    const imageResponse = firstCandidate ? await apiClient.request(`/candidates/${firstCandidate.candidateId}/images/${imageRole}`) : undefined;
    check(`Step 3: ${imageRole} image streams through the API`, Boolean(imageResponse?.ok && imageResponse.headers.get('content-type')?.startsWith('image/')));
  }
  return queueBody.candidateList;
}

async function checkApprove(apiClient: ApiClientInstance, candidateId: number): Promise<void> {
  await sendJson(apiClient, '/creator', 'PUT', { name: 'Demo creator' });
  check('Step 4: approve is blocked until the notice details are filled in', (await decide(apiClient, candidateId, { action: 'approve', goodFaith: true })).status === 422);
  check('Step 5: profile saves', (await sendJson(apiClient, '/creator', 'PUT', NOTICE_PROFILE)).ok);
  check('Step 6: approve without the good-faith box is refused', (await decide(apiClient, candidateId, { action: 'approve' })).status === 400);
  const approveResponse = await decide(apiClient, candidateId, { action: 'approve', goodFaith: true, note: 'my photo, reposted' });
  const approvedCandidate = await approveResponse.json() as CandidateSummary;
  check('Step 7: approve records an attributed audit row', approveResponse.ok && approvedCandidate.status === 'approved'
    && approvedCandidate.decisionList?.[0]?.actor === (process.env.ADMIN_USERNAME || 'admin'));
  check('Step 8: a closed candidate answers 409', (await decide(apiClient, candidateId, { action: 'dismiss' })).status === 409);
}

// 202 while the evidence worker builds it, then the ZIP itself
async function waitForPack(apiClient: ApiClientInstance, candidateId: number): Promise<Response | undefined> {
  const deadline = Date.now() + PACK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const packResponse = await apiClient.request(`/candidates/${candidateId}/pack`);
    if (packResponse.status !== 202) return packResponse;
    await new Promise((resolve) => setTimeout(resolve, PACK_POLL_MS));
  }
  return undefined;
}

async function checkPackAndNotice(apiClient: ApiClientInstance, candidateId: number): Promise<void> {
  const packResponse = await waitForPack(apiClient, candidateId);
  const packBytes = packResponse?.ok ? Buffer.from(await packResponse.arrayBuffer()) : Buffer.alloc(0);
  const zipFileNameList = ['original.', 'copy.', 'side_by_side.png', 'metadata.json', 'summary.pdf', 'notice.txt'];
  check('Step 8a: evidence ZIP downloads with every file', packBytes.subarray(0, 2).toString() === 'PK'
    && zipFileNameList.every((fileName) => packBytes.includes(Buffer.from(fileName))), `${packBytes.length} bytes, HTTP ${packResponse?.status ?? 'timeout'}`);
  const noticeBody = await (await apiClient.request(`/candidates/${candidateId}/notice`)).json() as { noticeText?: string };
  const noticeText = noticeBody.noticeText ?? '';
  check('Step 8b: notice has every placeholder resolved', noticeText.length > 0 && !noticeText.includes('{{') && noticeText.includes(NOTICE_PROFILE.legalName));
  check('Step 8c: an edit that reintroduces a placeholder is refused',
    (await sendJson(apiClient, `/candidates/${candidateId}/notice`, 'PUT', { noticeText: `${noticeText}\n{{legal_name}}` })).status === 400);
  check('Step 8d: a resolved edit saves', (await sendJson(apiClient, `/candidates/${candidateId}/notice`, 'PUT', { noticeText: `${noticeText}\nP.S. edited` })).ok);
  check('Step 8e: regenerate rebuilds the pack', (await apiClient.request(`/candidates/${candidateId}/pack`, { method: 'POST' })).status === 202
    && (await waitForPack(apiClient, candidateId))?.ok === true);
}

async function checkOtherDecisions(apiClient: ApiClientInstance, escalateId: number, legitimateId: number): Promise<void> {
  check('Step 9: escalate', (await decide(apiClient, escalateId, { action: 'escalate', note: 'heavy crop' })).ok);
  const escalatedBody = await (await apiClient.request('/candidates?status=escalated')).json() as { candidateList: CandidateSummary[] };
  check('Step 10: escalated list holds it', escalatedBody.candidateList.some((candidate) => candidate.candidateId === escalateId));
  check('Step 11: an escalated candidate can still be decided', (await decide(apiClient, escalateId, { action: 'dismiss' })).ok);
  const legitimateResponse = await decide(apiClient, legitimateId, { action: 'legitimate', note: 'licensed use' });
  check('Step 12: dismiss as legitimate', legitimateResponse.ok && (await legitimateResponse.json() as CandidateSummary).status === 'legitimate');
}

async function checkTemplates(apiClient: ApiClientInstance): Promise<void> {
  const templateBody = await (await apiClient.request('/notice-templates')).json() as { noticeTemplateList: { platform: string }[] };
  const seededPlatformList = templateBody.noticeTemplateList.map((template) => template.platform);
  check('Step 13: Reddit and Bluesky templates are seeded', seededPlatformList.includes('reddit') && seededPlatformList.includes('bluesky'));
  const draftTemplate = { platform: 'reddit', name: 'Check', subject: 'Notice {{infringing_url}}', body: 'From {{legal_name}}' };
  check('Step 14: unknown placeholder is rejected', (await sendJson(apiClient, '/notice-templates', 'POST', { ...draftTemplate, body: '{{legal_nme}}' })).status === 400);
  const createResponse = await sendJson(apiClient, '/notice-templates', 'POST', draftTemplate);
  const createdTemplate = await createResponse.json() as { templateId: number };
  check('Step 15: template create, update, delete', createResponse.status === 201
    && (await sendJson(apiClient, `/notice-templates/${createdTemplate.templateId}`, 'PUT', { ...draftTemplate, name: 'Check 2' })).ok
    && (await apiClient.request(`/notice-templates/${createdTemplate.templateId}`, { method: 'DELETE' })).status === 204);
}

async function runPhase4Check(): Promise<void> {
  const apiClient = await createApiClient(API_URL);
  const pendingCandidateList = await checkQueueAndImages(apiClient);
  const [approveTarget, escalateTarget, legitimateTarget] = pendingCandidateList;
  if (!approveTarget || !escalateTarget || !legitimateTarget) throw new Error('Need at least 3 pending candidates from the phase 2 gate');
  await checkApprove(apiClient, approveTarget.candidateId);
  await checkPackAndNotice(apiClient, approveTarget.candidateId);
  check('Step 8f: a non-approved candidate has no pack', (await apiClient.request(`/candidates/${escalateTarget.candidateId}/pack`)).status === 404);
  await checkOtherDecisions(apiClient, escalateTarget.candidateId, legitimateTarget.candidateId);
  await checkTemplates(apiClient);
  await apiClient.request('/auth/logout', { method: 'POST' });
  check('Step 16: logout ends the session', (await apiClient.request('/candidates')).status === 401);
  console.log(failureList.length ? `Phase 4 API check FAILED: ${failureList.length} step(s)` : 'Phase 4 API check passed');
  if (failureList.length) process.exit(1);
}

runPhase4Check().catch((error) => {
  console.error('Phase 4 API check crashed', error);
  process.exit(1);
});
