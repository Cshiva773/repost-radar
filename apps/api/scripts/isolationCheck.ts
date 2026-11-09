// Phase 4 gate, many creators: a second creator signs up and must see none of the first creator's data, keep their
// own templates, and get their own matches from a source the first creator already watches.
import { signUpApiClient, type ApiClientInstance } from './apiClient.js';

const SECOND_CREATOR_PASSWORD = 'second-creator-gate-password';
const MATCH_WAIT_MS = 150_000;
const MATCH_POLL_MS = 5_000;
const ALL_STATUSES = 'pending,escalated,approved,dismissed,legitimate,removed,suppressed';

export type CheckFunction = (stepLabel: string, isPassing: boolean, detailText?: string) => void;

interface FirstCreatorDetails {
  candidateId: number;
  assetId: number;
}

async function readJson<BodyType>(apiClient: ApiClientInstance, requestPath: string): Promise<BodyType> {
  return await (await apiClient.request(requestPath)).json() as BodyType;
}

async function signUpSecondCreator(apiUrl: string, check: CheckFunction): Promise<ApiClientInstance | undefined> {
  const email = `second-creator-${Date.now()}@example.com`;
  const { signupResponse, apiClient } = await signUpApiClient(apiUrl, { email, password: SECOND_CREATOR_PASSWORD, displayName: 'Second creator' });
  const meBody = apiClient ? await readJson<{ username?: string }>(apiClient, '/auth/me') : {};
  check('Step 23a: sign-up creates an account and signs it in', signupResponse.status === 201 && meBody.username === email, `HTTP ${signupResponse.status}`);
  const duplicateResult = await signUpApiClient(apiUrl, { email: email.toUpperCase(), password: SECOND_CREATOR_PASSWORD });
  check('Step 23b: the same email cannot sign up twice', duplicateResult.signupResponse.status === 409, `HTTP ${duplicateResult.signupResponse.status}`);
  return apiClient;
}

async function checkStartsEmpty(secondClient: ApiClientInstance, check: CheckFunction): Promise<void> {
  const assetBody = await readJson<{ totalCount: number }>(secondClient, '/assets?pageSize=1');
  const targetBody = await readJson<{ watchTargetCount: number }>(secondClient, '/watch-targets');
  const candidateBody = await readJson<{ totalCount: number }>(secondClient, `/candidates?status=${ALL_STATUSES}`);
  const templateBody = await readJson<{ noticeTemplateList: { platform: string }[] }>(secondClient, '/notice-templates');
  const templatePlatformList = templateBody.noticeTemplateList.map((noticeTemplate) => noticeTemplate.platform).sort();
  check('Step 23c: a new creator starts empty, with their own copy of the default templates',
    assetBody.totalCount === 0 && targetBody.watchTargetCount === 0 && candidateBody.totalCount === 0 && templatePlatformList.join(',') === 'bluesky,reddit',
    `${assetBody.totalCount} originals, ${targetBody.watchTargetCount} sources, ${candidateBody.totalCount} matches, templates ${templatePlatformList.join('+')}`);
}

async function checkCannotSeeFirstCreator(adminClient: ApiClientInstance, secondClient: ApiClientInstance, firstCreator: FirstCreatorDetails,
  check: CheckFunction): Promise<void> {
  const adminTemplateBody = await readJson<{ noticeTemplateList: { templateId: number; platform: string; name: string; subject: string; body: string }[] }>(adminClient, '/notice-templates');
  const adminTemplate = adminTemplateBody.noticeTemplateList[0];
  const statusList = await Promise.all([
    `/candidates/${firstCreator.candidateId}`, `/candidates/${firstCreator.candidateId}/notice`, `/assets/${firstCreator.assetId}`,
    `/assets/${firstCreator.assetId}/image`, `/notice-templates/${adminTemplate?.templateId ?? 0}`,
  ].map(async (requestPath) => (await secondClient.request(requestPath)).status));
  const updateStatus = (await secondClient.request(`/notice-templates/${adminTemplate?.templateId ?? 0}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...adminTemplate, subject: 'Taken over' }),
  })).status;
  const metricsStatus = (await secondClient.request('/metrics')).status;
  check('Step 23d: a creator cannot read or change another creator\'s matches, originals or templates',
    statusList.every((statusCode) => statusCode === 404) && updateStatus === 404 && metricsStatus === 403,
    `reads ${statusList.join('/')}, template update ${updateStatus}, metrics ${metricsStatus}`);
}

async function checkTemplatesAreSeparate(adminClient: ApiClientInstance, secondClient: ApiClientInstance, check: CheckFunction): Promise<void> {
  const secondTemplateBody = await readJson<{ noticeTemplateList: { templateId: number; platform: string; name: string; body: string }[] }>(secondClient, '/notice-templates');
  const secondRedditTemplate = secondTemplateBody.noticeTemplateList.find((noticeTemplate) => noticeTemplate.platform === 'reddit');
  const updateResponse = await secondClient.request(`/notice-templates/${secondRedditTemplate?.templateId ?? 0}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...secondRedditTemplate, subject: 'Only the second creator sees this' }),
  });
  const adminTemplateBody = await readJson<{ noticeTemplateList: { subject: string }[] }>(adminClient, '/notice-templates');
  check('Step 23e: editing your own template changes nobody else\'s',
    updateResponse.ok && adminTemplateBody.noticeTemplateList.every((noticeTemplate) => noticeTemplate.subject !== 'Only the second creator sees this'));
}

async function uploadCopyOfFirstOriginal(adminClient: ApiClientInstance, secondClient: ApiClientInstance, assetId: number): Promise<number | undefined> {
  const imageBuffer = Buffer.from(await (await adminClient.request(`/assets/${assetId}/image`)).arrayBuffer());
  const uploadForm = new FormData();
  uploadForm.append('file', new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }), 'second-creator-original.jpg');
  const uploadResponse = await secondClient.request('/assets', { method: 'POST', body: uploadForm });
  return uploadResponse.status === 202 ? (await uploadResponse.json() as { assetId: number }).assetId : undefined;
}

async function waitForOwnMatch(secondClient: ApiClientInstance, secondAssetId: number): Promise<boolean> {
  const deadline = Date.now() + MATCH_WAIT_MS;
  while (Date.now() < deadline) {
    const candidateBody = await readJson<{ candidateList: { assetId: number }[] }>(secondClient, '/candidates?status=pending&pageSize=50');
    if (candidateBody.candidateList.some((candidate) => candidate.assetId === secondAssetId)) return true;
    await new Promise((resolve) => setTimeout(resolve, MATCH_POLL_MS));
  }
  return false;
}

// The bug this guards against: posts were stored once per platform post, so a second creator watching the same
// account had every post skipped as "already stored" and never got a match
async function checkSharedWatching(adminClient: ApiClientInstance, secondClient: ApiClientInstance, firstCreator: FirstCreatorDetails,
  check: CheckFunction): Promise<void> {
  const adminTargetBody = await readJson<{ watchTargetList: { platform: string; targetName: string; enabled: boolean }[] }>(adminClient, '/watch-targets');
  const sharedTarget = adminTargetBody.watchTargetList.find((watchTarget) => watchTarget.enabled);
  const adminCountBefore = (await readJson<{ totalCount: number }>(adminClient, `/candidates?status=${ALL_STATUSES}`)).totalCount;
  const secondAssetId = await uploadCopyOfFirstOriginal(adminClient, secondClient, firstCreator.assetId);
  await secondClient.request('/watch-targets', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: sharedTarget?.platform, target: sharedTarget?.targetName, pollIntervalSeconds: 300 }),
  });
  const isMatched = secondAssetId !== undefined && await waitForOwnMatch(secondClient, secondAssetId);
  const adminCountAfter = (await readJson<{ totalCount: number }>(adminClient, `/candidates?status=${ALL_STATUSES}`)).totalCount;
  check('Step 23f: two creators watching the same source each get their own matches', isMatched && adminCountAfter === adminCountBefore,
    `${sharedTarget?.platform}:${sharedTarget?.targetName}, second creator's original #${secondAssetId ?? '?'}, first creator ${adminCountBefore} → ${adminCountAfter} matches`);
}

export async function checkCreatorIsolation(apiUrl: string, adminClient: ApiClientInstance, firstCreator: FirstCreatorDetails, check: CheckFunction): Promise<void> {
  const secondClient = await signUpSecondCreator(apiUrl, check);
  if (!secondClient) return;
  await checkStartsEmpty(secondClient, check);
  await checkCannotSeeFirstCreator(adminClient, secondClient, firstCreator, check);
  await checkTemplatesAreSeparate(adminClient, secondClient, check);
  await checkSharedWatching(adminClient, secondClient, firstCreator, check);
}
