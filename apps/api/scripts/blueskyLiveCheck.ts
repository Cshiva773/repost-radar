// Live end-to-end check against real Bluesky, with no posting: pick a recent public #photography post,
// register its image as an "original" in this (throwaway) stack, then watch #photography and wait for
// the crawler and matcher to find that very post and queue it. Run by scripts/bluesky-live-gate.sh.
import { createApiClient, loadRepoEnv, type ApiClientInstance } from './apiClient.js';

loadRepoEnv();
const API_URL = process.env.API_URL ?? 'http://localhost:8080';
const LIVE_HASHTAG = process.env.LIVE_HASHTAG ?? '#photography';
const SEARCH_URL = 'https://api.bsky.app/xrpc/app.bsky.feed.searchPosts';
const USER_AGENT = 'repost-radar/0.1 (https://github.com/Cshiva773/repost-radar; live check)';
const ADULT_LABEL_SET = new Set(['porn', 'sexual', 'nudity', 'graphic-media']);
const MATCH_TIMEOUT_MS = 300_000;
const POLL_MS = 5_000;

interface LivePostDetails {
  postUri: string;
  recordKey: string;
  imageUrl: string;
}

interface SearchPostView {
  uri: string;
  labels?: { val?: string }[];
  embed?: { $type?: string; images?: { fullsize?: string }[]; media?: { images?: { fullsize?: string }[] } };
}

const failureList: string[] = [];

function check(stepLabel: string, isPassing: boolean, detailText = ''): void {
  console.log(`${isPassing ? 'PASS' : 'FAIL'}  ${stepLabel}${detailText ? `  (${detailText})` : ''}`);
  if (!isPassing) failureList.push(stepLabel);
}

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function firstImageUrl(postView: SearchPostView): string | undefined {
  const imageList = postView.embed?.images ?? postView.embed?.media?.images ?? [];
  return imageList[0]?.fullsize;
}

async function pickLivePost(): Promise<LivePostDetails> {
  const searchUrl = new URL(SEARCH_URL);
  searchUrl.searchParams.set('q', LIVE_HASHTAG);
  searchUrl.searchParams.set('sort', 'latest');
  searchUrl.searchParams.set('limit', '50');
  const searchResponse = await fetch(searchUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!searchResponse.ok) throw new Error(`Bluesky search failed: HTTP ${searchResponse.status}`);
  const postList = ((await searchResponse.json()) as { posts?: SearchPostView[] }).posts ?? [];
  const livePost = postList.find((postView) => firstImageUrl(postView) && !(postView.labels ?? []).some((label) => ADULT_LABEL_SET.has(label.val ?? '')));
  const imageUrl = livePost ? firstImageUrl(livePost) : undefined;
  if (!livePost || !imageUrl) throw new Error(`No recent ${LIVE_HASHTAG} post with an image`);
  return { postUri: livePost.uri, recordKey: livePost.uri.split('/').pop() ?? '', imageUrl };
}

async function registerOriginal(apiClient: ApiClientInstance, imageUrl: string): Promise<number> {
  const imageResponse = await fetch(imageUrl, { headers: { 'User-Agent': USER_AGENT } });
  const uploadForm = new FormData();
  uploadForm.append('file', new Blob([new Uint8Array(await imageResponse.arrayBuffer())]), 'live-original');
  const uploadBody = await (await apiClient.request('/assets', { method: 'POST', body: uploadForm })).json() as { assetId?: number; existingAssetId?: number; message?: string };
  const assetId = uploadBody.assetId ?? uploadBody.existingAssetId;
  if (!assetId) throw new Error(`Upload failed: ${uploadBody.message ?? 'no asset id'}`);
  for (let deadline = Date.now() + 120_000; Date.now() < deadline; await pause(2_000)) {
    if ((await (await apiClient.request(`/assets/${assetId}`)).json() as { isFingerprinted: boolean }).isFingerprinted) return assetId;
  }
  throw new Error(`Asset ${assetId} was not fingerprinted in time`);
}

async function waitForLiveCandidate(apiClient: ApiClientInstance, assetId: number, recordKey: string) {
  for (let deadline = Date.now() + MATCH_TIMEOUT_MS; Date.now() < deadline; await pause(POLL_MS)) {
    const candidatePage = await (await apiClient.request('/candidates?status=pending&platform=bluesky&pageSize=100')).json() as {
      candidateList: { candidateId: number; assetId: number; postUrl: string; confidence: number }[];
    };
    const liveCandidate = candidatePage.candidateList.find((candidate) => candidate.assetId === assetId && candidate.postUrl.endsWith(`/post/${recordKey}`));
    if (liveCandidate) return liveCandidate;
  }
  return undefined;
}

async function runLiveCheck(): Promise<void> {
  const apiClient = await createApiClient(API_URL);
  const livePost = await pickLivePost();
  console.log(`Step 1: picked ${livePost.postUri}`);
  const assetId = await registerOriginal(apiClient, livePost.imageUrl);
  check('Step 2: the live post\'s image is registered and fingerprinted', assetId > 0, `asset ${assetId}`);
  const watchResponse = await apiClient.request('/watch-targets', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'bluesky', target: LIVE_HASHTAG, pollIntervalSeconds: 60 }) });
  check(`Step 3: ${LIVE_HASHTAG} is watched`, watchResponse.status === 201 || watchResponse.status === 409, `HTTP ${watchResponse.status}`);
  const liveCandidate = await waitForLiveCandidate(apiClient, assetId, livePost.recordKey);
  check('Step 4: the crawler found that live post and queued it for review', Boolean(liveCandidate) && (liveCandidate?.confidence ?? 0) >= 0.95,
    liveCandidate ? `candidate ${liveCandidate.candidateId} at ${liveCandidate.confidence.toFixed(3)}` : 'not found within 5 minutes');
  const copyImageStatus = liveCandidate ? (await apiClient.request(`/candidates/${liveCandidate.candidateId}/images/candidate`)).status : 0;
  check('Step 5: the crawled copy is stored and served', copyImageStatus === 200, `HTTP ${copyImageStatus}`);
  console.log(failureList.length ? `Live Bluesky check FAILED: ${failureList.length} step(s)` : 'Live Bluesky check passed');
  if (failureList.length) process.exit(1);
}

runLiveCheck().catch((error) => {
  console.error('Live Bluesky check crashed', error);
  process.exit(1);
});
