// `pnpm dev:mock`: answers /api/* from in-memory fixtures so the UI can be developed, demoed and
// screenshotted without Docker. Mirrors the real API's shapes and status codes; never used in builds.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

type MockStatus = 'pending' | 'approved' | 'dismissed' | 'legitimate' | 'escalated';

interface MockDecision {
  decisionId: number;
  actor: string;
  fromStatus: string;
  toStatus: string;
  note: string | null;
  decidedAt: string;
}

interface MockCandidate {
  candidateId: number; status: MockStatus; confidence: number; hashDistance: number | null; embedSimilarity: number;
  createdAt: string; assetId: number; platform: string; targetName: string; postAuthor: string | null; postTitle: string | null;
  postUrl: string; postedAt: string; hue: number; edit: string; decisionList: MockDecision[];
  packPollsLeft: number | undefined; noticeText: string | undefined;
}

const MOCK_PASSWORD = 'change-me-local-only';
const EDIT_LIST = ['resize', 'crop 20%', 'warm filter', 'meme caption', 'screenshot', 'JPEG q40', 'flip', 'rotate 10°', 'resize'];
const PLACEHOLDER_NAME_LIST = ['infringing_url', 'post_author', 'post_title', 'target_name', 'posted_at', 'platform_name', 'original_sha256',
  'original_extension', 'creator_name', 'legal_name', 'mailing_address', 'contact_email', 'candidate_id', 'confidence', 'detected_at', 'today'];

function hoursAgo(hourCount: number): string {
  return new Date(Date.now() - hourCount * 3_600_000).toISOString();
}

function buildCandidate(index: number): MockCandidate {
  const isBluesky = index % 3 === 2;
  const edit = EDIT_LIST[index] ?? 'resize';
  return {
    candidateId: 101 + index, status: index === 7 ? 'escalated' : index === 8 ? 'dismissed' : 'pending',
    confidence: Number((0.99 - index * 0.031).toFixed(3)), hashDistance: index < 4 ? 4 + index * 6 : 60 + index * 9,
    embedSimilarity: Number((0.98 - index * 0.02).toFixed(3)), createdAt: hoursAgo(index + 1), assetId: index + 1,
    platform: isBluesky ? 'bluesky' : 'reddit', targetName: isBluesky ? '#photography' : index % 2 ? 'EarthPorn' : 'pics',
    postAuthor: isBluesky ? `lens${index}.bsky.social` : `throwaway_${index}42`, postTitle: isBluesky ? null : `Look at this view I found (${edit})`,
    postUrl: isBluesky ? `https://bsky.app/profile/lens${index}.bsky.social/post/3k${index}` : `https://www.reddit.com/r/pics/comments/x${index}/`,
    postedAt: hoursAgo(index * 3 + 2), hue: (index * 47) % 360, edit, decisionList: [], packPollsLeft: undefined, noticeText: undefined,
  };
}

function buildMockState() {
  return {
    isSignedIn: false,
    candidateList: Array.from({ length: 9 }, (_unused, index) => buildCandidate(index)),
    profile: { creatorId: 1, name: 'Demo creator', legalName: null as string | null, contactEmail: null as string | null, mailingAddress: null as string | null },
    templateList: [
      { templateId: 1, platform: 'reddit', name: 'Reddit copyright notice', subject: 'Copyright infringement notice: {{infringing_url}}',
        body: 'Infringing post: {{infringing_url}}\nPosted by u/{{post_author}} in r/{{target_name}}\n\nSigned: /{{legal_name}}/\n{{contact_email}}', updatedAt: hoursAgo(48) },
      { templateId: 2, platform: 'bluesky', name: 'Bluesky copyright notice', subject: 'Copyright infringement notice: {{infringing_url}}',
        body: 'Infringing post: {{infringing_url}}\nPosted by @{{post_author}}\n\nSigned: /{{legal_name}}/\n{{contact_email}}', updatedAt: hoursAgo(48) },
    ],
  };
}

type MockState = ReturnType<typeof buildMockState>;

// A simple landscape; the "copy" applies a visible version of its edit so the compare view looks real
function landscapeSvg(hue: number, label: string, edit: string | undefined): string {
  const transformByEdit: Record<string, string> = { flip: 'translate(800 0) scale(-1 1)', 'rotate 10°': 'rotate(10 400 300)', 'crop 20%': 'translate(-80 -60) scale(1.2)' };
  const overlay = edit === 'warm filter' ? '<rect width="800" height="600" fill="hsl(30 90% 55%)" opacity="0.18"/>'
    : edit === 'meme caption' ? '<text x="400" y="70" font-size="56" font-family="Impact, sans-serif" fill="white" stroke="black" stroke-width="3" text-anchor="middle">WHEN THE VIEW HITS</text>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><g transform="${transformByEdit[edit ?? ''] ?? ''}">
<rect width="800" height="600" fill="hsl(${hue} 60% 78%)"/><circle cx="600" cy="150" r="70" fill="hsl(${(hue + 40) % 360} 90% 70%)"/>
<path d="M0 420 L220 220 L380 380 L520 250 L800 470 L800 600 L0 600Z" fill="hsl(${hue} 35% 38%)"/>
<path d="M0 500 Q200 440 400 500 T800 490 L800 600 L0 600Z" fill="hsl(${(hue + 160) % 360} 40% 30%)"/></g>${overlay}
<text x="16" y="584" font-size="18" font-family="sans-serif" fill="white" opacity="0.85">${label}</text></svg>`;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunkList: Buffer[] = [];
  for await (const chunk of request) chunkList.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunkList).toString() || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function sendJson(response: ServerResponse, statusCode: number, responseBody?: unknown): void {
  response.statusCode = statusCode;
  if (responseBody === undefined) return void response.end();
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(responseBody));
}

function summarise(candidate: MockCandidate) {
  const { hue: _hue, edit: _edit, decisionList: _decisionList, packPollsLeft, noticeText: _noticeText, ...summaryFields } = candidate;
  return { ...summaryFields, hasEvidencePack: packPollsLeft === 0, evidenceError: null };
}

function isProfileComplete(state: MockState): boolean {
  return Boolean(state.profile.legalName && state.profile.contactEmail && state.profile.mailingAddress);
}

function checkDecision(state: MockState, candidate: MockCandidate, toStatus: MockStatus | undefined, requestBody: Record<string, unknown>): [number, unknown] | undefined {
  if (!toStatus) return [400, { isError: true, message: 'action must be one of: approve, dismiss, legitimate, escalate' }];
  if (!['pending', 'escalated'].includes(candidate.status) || candidate.status === toStatus) {
    return [409, { isError: true, message: `This candidate is already ${candidate.status} and cannot be changed` }];
  }
  if (toStatus === 'approved' && requestBody.goodFaith !== true) return [400, { isError: true, message: 'Approving needs the good-faith statement to be confirmed' }];
  if (toStatus === 'approved' && !isProfileComplete(state)) {
    return [422, { isError: true, message: 'Add your legal name, contact email and mailing address in Settings before approving: the notice needs them.' }];
  }
  return undefined;
}

function decide(state: MockState, candidate: MockCandidate, requestBody: Record<string, unknown>): [number, unknown] {
  const statusByAction: Record<string, MockStatus> = { approve: 'approved', dismiss: 'dismissed', legitimate: 'legitimate', escalate: 'escalated' };
  const toStatus = statusByAction[String(requestBody.action)];
  const rejection = checkDecision(state, candidate, toStatus, requestBody);
  if (rejection || !toStatus) return rejection ?? [400, {}];
  candidate.decisionList.push({ decisionId: Date.now(), actor: 'admin', fromStatus: candidate.status, toStatus, note: (requestBody.note as string) || null, decidedAt: new Date().toISOString() });
  candidate.status = toStatus;
  if (toStatus === 'approved') {
    candidate.packPollsLeft = 2;
    candidate.noticeText = `Subject: Copyright infringement notice: ${candidate.postUrl}\n\nInfringing post: ${candidate.postUrl}\n`
      + `Posted by ${candidate.postAuthor}\n\nSigned: /${state.profile.legalName}/\n${state.profile.contactEmail}`;
  }
  return [200, { ...summarise(candidate), decisionList: candidate.decisionList }];
}

function listCandidates(state: MockState, searchParams: URLSearchParams): unknown {
  const statusList = (searchParams.get('status') ?? 'pending').split(',');
  const pageSize = Number(searchParams.get('pageSize') ?? 25);
  const pageOffset = Number(searchParams.get('pageOffset') ?? 0);
  const platformFilter = searchParams.get('platform');
  const matchingList = state.candidateList
    .filter((candidate) => statusList.includes(candidate.status) && (!platformFilter || candidate.platform === platformFilter))
    .sort((left, right) => (searchParams.get('sort') === 'newest' ? right.createdAt.localeCompare(left.createdAt) : right.confidence - left.confidence));
  const candidateList = matchingList.slice(pageOffset, pageOffset + pageSize).map(summarise);
  return { candidateList, candidateCount: candidateList.length, totalCount: matchingList.length, pageSize, pageOffset };
}

function handleNotice(candidate: MockCandidate, method: string, requestBody: Record<string, unknown>): [number, unknown] {
  if (candidate.status !== 'approved') return [404, { isError: true, message: 'Only approved candidates have an evidence pack' }];
  if (method === 'PUT') {
    const noticeText = String(requestBody.noticeText ?? '');
    if (/\{\{[^{}]*\}\}/.test(noticeText)) return [400, { isError: true, message: 'The notice still contains placeholder(s)' }];
    candidate.noticeText = noticeText;
    return [200, { noticeText }];
  }
  if ((candidate.packPollsLeft ?? 0) > 0) {
    candidate.packPollsLeft = (candidate.packPollsLeft ?? 1) - 1;
    return [202, { isError: false, message: 'The notice is being generated' }];
  }
  return [200, { noticeText: candidate.noticeText, templateId: 1, generatedAt: new Date().toISOString() }];
}

function handleCandidatePath(state: MockState, requestPath: string, method: string, requestBody: Record<string, unknown>, response: ServerResponse): void {
  const candidateMatch = /^\/candidates\/(\d+)(?:\/(decision|notice|pack|images\/(original|candidate)))?$/.exec(requestPath);
  const candidate = candidateMatch ? state.candidateList.find((mockCandidate) => mockCandidate.candidateId === Number(candidateMatch[1])) : undefined;
  if (!candidateMatch || !candidate) return sendJson(response, 404, { isError: true, message: 'Not found' });
  const [, , subPath, imageRole] = candidateMatch;
  if (imageRole) {
    response.setHeader('content-type', 'image/svg+xml');
    return void response.end(landscapeSvg(candidate.hue, imageRole === 'original' ? 'original' : `copy: ${candidate.edit}`, imageRole === 'candidate' ? candidate.edit : undefined));
  }
  if (subPath === 'decision') return sendJson(response, ...decide(state, candidate, requestBody));
  if (subPath === 'notice') return sendJson(response, ...handleNotice(candidate, method, requestBody));
  if (subPath === 'pack') return sendJson(response, 202, { status: 'generating', message: 'The mock API does not build real ZIPs' });
  return sendJson(response, 200, { ...summarise(candidate), decisionList: candidate.decisionList });
}

function handleSettingsPath(state: MockState, requestPath: string, method: string, requestBody: Record<string, unknown>, response: ServerResponse): boolean {
  if (requestPath === '/platforms') {
    sendJson(response, 200, { platformList: [{ platformName: 'reddit', displayName: 'Reddit' }, { platformName: 'bluesky', displayName: 'Bluesky' }] });
  } else if (requestPath === '/creator') {
    if (method === 'PUT') Object.assign(state.profile, requestBody);
    sendJson(response, 200, { ...state.profile, isNoticeReady: isProfileComplete(state) });
  } else if (requestPath === '/notice-templates') {
    if (method === 'POST') {
      const { platform, name, subject, body } = requestBody as Record<string, string>;
      state.templateList.push({ platform: platform ?? 'reddit', name: name ?? '', subject: subject ?? '', body: body ?? '', templateId: Date.now(), updatedAt: new Date().toISOString() });
    }
    const placeholderList = PLACEHOLDER_NAME_LIST.map((name) => ({ name, description: name.replaceAll('_', ' ') }));
    sendJson(response, method === 'POST' ? 201 : 200, { noticeTemplateList: state.templateList, placeholderList });
  } else {
    return false;
  }
  return true;
}

async function routeRequest(state: MockState, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url ?? '/', 'http://mock');
  const requestPath = requestUrl.pathname;
  const method = request.method ?? 'GET';
  const requestBody = method === 'GET' ? {} : await readJsonBody(request);
  if (requestPath === '/auth/login') {
    if (requestBody.password !== MOCK_PASSWORD) return sendJson(response, 401, { isError: true, message: 'Invalid username or password' });
    state.isSignedIn = true;
    return sendJson(response, 200, { username: 'admin' });
  }
  if (!state.isSignedIn) return sendJson(response, 401, { isError: true, message: 'Sign in to continue' });
  if (requestPath === '/auth/logout') { state.isSignedIn = false; return sendJson(response, 204); }
  if (requestPath === '/auth/me') return sendJson(response, 200, { username: 'admin' });
  if (handleSettingsPath(state, requestPath, method, requestBody, response)) return;
  if (requestPath === '/candidates') return sendJson(response, 200, listCandidates(state, requestUrl.searchParams));
  handleCandidatePath(state, requestPath, method, requestBody, response);
}

export function mockApiPlugin(): Plugin {
  const state = buildMockState();
  return {
    name: 'repost-radar-mock-api',
    configureServer(server) {
      // Connect strips the /api mount prefix, so request.url is already the API path
      server.middlewares.use('/api', (request, response) => void routeRequest(state, request, response));
    },
  };
}
