// Typed client for the review API. In the browser every path is prefixed with /api, which the dev
// server and the nginx container both proxy to the API, so the session cookie stays same-origin.

export const API_BASE_PATH = '/api';

export type CandidateStatus = 'suppressed' | 'pending' | 'approved' | 'dismissed' | 'legitimate' | 'escalated' | 'removed';
export type DecisionAction = 'approve' | 'dismiss' | 'legitimate' | 'escalate';

export interface CandidateSummary {
  candidateId: number;
  status: CandidateStatus;
  confidence: number;
  hashDistance: number | null;
  embedSimilarity: number | null;
  createdAt: string;
  assetId: number;
  platform: string;
  targetName: string;
  postAuthor: string | null;
  postTitle: string | null;
  postUrl: string;
  postedAt: string | null;
  hasEvidencePack: boolean;
  evidenceError: string | null;
}

export interface DecisionRecord {
  decisionId: number;
  actor: string;
  fromStatus: CandidateStatus;
  toStatus: CandidateStatus;
  note: string | null;
  decidedAt: string;
}

export interface CandidateDetails extends CandidateSummary {
  decisionList: DecisionRecord[];
}

export interface CandidatePage {
  candidateList: CandidateSummary[];
  candidateCount: number;
  totalCount: number;
  pageSize: number;
  pageOffset: number;
}

export interface NoticeDetails {
  noticeText: string;
  templateId: number | null;
  generatedAt: string;
}

export interface NoticeTemplate {
  templateId: number;
  platform: string;
  name: string;
  subject: string;
  body: string;
  updatedAt: string;
}

export interface PlaceholderDescription {
  name: string;
  description: string;
}

export interface CreatorProfile {
  creatorId: number;
  name: string;
  legalName: string | null;
  contactEmail: string | null;
  mailingAddress: string | null;
  isNoticeReady: boolean;
}

export interface PlatformDescription {
  platformName: string;
  displayName: string;
  targetLabel: string;
  targetExample: string;
  maxRequestsPerMinute: number;
}

export interface ApiTokenSummary {
  tokenId: number;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AssetSummary {
  assetId: number;
  sha256: string;
  mimeType: string;
  isFingerprinted: boolean;
  createdAt: string;
}

export interface AssetPage {
  assetList: AssetSummary[];
  assetCount: number;
  totalCount: number;
}

export interface WatchTargetStatus {
  watchTargetId: number;
  platform: string;
  targetName: string;
  pollIntervalSeconds: number;
  enabled: boolean;
  lastCrawledAt: string | null;
  lastError: string | null;
  postsSeenCount: number;
  candidatesFoundCount: number;
}

export class ApiError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

const GENERIC_ERROR_MESSAGE = 'Something went wrong';

export async function readErrorMessage(errorResponse: Response): Promise<string> {
  try {
    const errorBody = await errorResponse.json() as { message?: string };
    return errorBody.message || GENERIC_ERROR_MESSAGE;
  } catch {
    return GENERIC_ERROR_MESSAGE;
  }
}

export async function apiRequest<ResponseType>(requestPath: string, requestInit: RequestInit = {}): Promise<ResponseType> {
  const hasJsonBody = typeof requestInit.body === 'string';
  const apiResponse = await fetch(`${API_BASE_PATH}${requestPath}`, {
    ...requestInit,
    credentials: 'same-origin',
    headers: { ...(hasJsonBody ? { 'content-type': 'application/json' } : {}), ...(requestInit.headers as Record<string, string> | undefined) },
  });
  if (!apiResponse.ok) throw new ApiError(apiResponse.status, await readErrorMessage(apiResponse));
  if (apiResponse.status === 204) return undefined as ResponseType;
  return await apiResponse.json() as ResponseType;
}

export function sendJson<ResponseType>(requestPath: string, method: string, requestBody: unknown): Promise<ResponseType> {
  return apiRequest<ResponseType>(requestPath, { method, body: JSON.stringify(requestBody) });
}

export function candidateImageUrl(candidateId: number, imageRole: 'original' | 'candidate'): string {
  return `${API_BASE_PATH}/candidates/${candidateId}/images/${imageRole}`;
}

export function assetImageUrl(assetId: number): string {
  return `${API_BASE_PATH}/assets/${assetId}/image`;
}

export function candidatePackUrl(candidateId: number): string {
  return `${API_BASE_PATH}/candidates/${candidateId}/pack`;
}

export interface CandidateQueryDetails {
  statusList: CandidateStatus[];
  platform?: string;
  sort?: 'confidence' | 'newest';
  pageSize: number;
  pageOffset: number;
}

export function buildCandidateQuery(queryDetails: CandidateQueryDetails): string {
  const searchParams = new URLSearchParams({
    status: queryDetails.statusList.join(','), sort: queryDetails.sort ?? 'confidence',
    pageSize: String(queryDetails.pageSize), pageOffset: String(queryDetails.pageOffset),
  });
  if (queryDetails.platform) searchParams.set('platform', queryDetails.platform);
  return `/candidates?${searchParams.toString()}`;
}
