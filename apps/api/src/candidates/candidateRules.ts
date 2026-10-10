export const CANDIDATE_STATUS_LIST = ['suppressed', 'pending', 'approved', 'dismissed', 'legitimate', 'escalated'] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUS_LIST)[number];

export const DECISION_ACTION_LIST = ['approve', 'dismiss', 'legitimate', 'escalate'] as const;
export type DecisionAction = (typeof DECISION_ACTION_LIST)[number];

const STATUS_BY_ACTION: Record<DecisionAction, CandidateStatus> = {
  approve: 'approved',
  dismiss: 'dismissed',
  legitimate: 'legitimate',
  escalate: 'escalated',
};
// A reviewer can act on a candidate in the queue or on the second-look list; every other status is closed
const OPEN_STATUS_LIST: CandidateStatus[] = ['pending', 'escalated'];
const MAX_NOTE_LENGTH = 2000;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
export const CANDIDATE_SORT_LIST = ['confidence', 'newest'] as const;

export interface DecisionInputDetails {
  action: DecisionAction;
  note: string | undefined;
}

export type ParseResult<ValueType> = ({ isError: false } & ValueType) | { isError: true; message: string };

export type DecisionPlanResult = { isError: false; toStatus: CandidateStatus } | { isError: true; statusCode: number; message: string };

export interface CandidateFilterDetails {
  statusList: CandidateStatus[];
  platform: string | undefined;
  watchTargetId: number | undefined;
  postedAfter: Date | undefined;
  postedBefore: Date | undefined;
  sort: (typeof CANDIDATE_SORT_LIST)[number];
  pageSize: number;
  pageOffset: number;
}

function isDecisionAction(rawValue: unknown): rawValue is DecisionAction {
  return typeof rawValue === 'string' && (DECISION_ACTION_LIST as readonly string[]).includes(rawValue);
}

// Approval is the only path to a takedown notice, so it needs an explicit good-faith attestation (PRD legal guardrail)
export function parseDecisionBody(rawBody: unknown): ParseResult<{ decisionInput: DecisionInputDetails }> {
  const { action, note, goodFaith } = (rawBody ?? {}) as { action?: unknown; note?: unknown; goodFaith?: unknown };
  if (!isDecisionAction(action)) return { isError: true, message: `action must be one of: ${DECISION_ACTION_LIST.join(', ')}` };
  if (note !== undefined && note !== null && typeof note !== 'string') return { isError: true, message: 'note must be text' };
  const trimmedNote = typeof note === 'string' ? note.trim() : '';
  if (trimmedNote.length > MAX_NOTE_LENGTH) return { isError: true, message: `note must be at most ${MAX_NOTE_LENGTH} characters` };
  if (action === 'approve' && goodFaith !== true) {
    return { isError: true, message: 'Approving needs the good-faith statement to be confirmed (goodFaith: true)' };
  }
  return { isError: false, decisionInput: { action, note: trimmedNote || undefined } };
}

export function planDecision(currentStatus: CandidateStatus, action: DecisionAction): DecisionPlanResult {
  const toStatus = STATUS_BY_ACTION[action];
  if (!OPEN_STATUS_LIST.includes(currentStatus)) {
    return { isError: true, statusCode: 409, message: `This candidate is already ${currentStatus} and cannot be changed` };
  }
  if (currentStatus === toStatus) return { isError: true, statusCode: 409, message: `This candidate is already ${currentStatus}` };
  return { isError: false, toStatus };
}

function parseOptionalDate(rawValue: unknown): Date | undefined | 'invalid' {
  if (rawValue === undefined || rawValue === '') return undefined;
  const parsedDate = new Date(String(rawValue));
  return Number.isNaN(parsedDate.getTime()) ? 'invalid' : parsedDate;
}

function parseStatusList(rawValue: unknown): CandidateStatus[] | undefined {
  if (rawValue === undefined || rawValue === '') return ['pending'];
  const statusList = String(rawValue).split(',').map((statusName) => statusName.trim());
  return statusList.every((statusName) => (CANDIDATE_STATUS_LIST as readonly string[]).includes(statusName)) ? statusList as CandidateStatus[] : undefined;
}

function parsePositiveInteger(rawValue: unknown): number | undefined {
  const parsedValue = Number(rawValue);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : undefined;
}

export function parseCandidateFilters(rawQuery: unknown): ParseResult<{ filterDetails: CandidateFilterDetails }> {
  const queryDetails = (rawQuery ?? {}) as Record<string, string | undefined>;
  const statusList = parseStatusList(queryDetails.status);
  if (!statusList) return { isError: true, message: `status must be a comma-separated list of: ${CANDIDATE_STATUS_LIST.join(', ')}` };
  const postedAfter = parseOptionalDate(queryDetails.postedAfter);
  const postedBefore = parseOptionalDate(queryDetails.postedBefore);
  if (postedAfter === 'invalid' || postedBefore === 'invalid') return { isError: true, message: 'postedAfter and postedBefore must be ISO dates' };
  const sort = queryDetails.sort === 'newest' ? 'newest' : 'confidence';
  return {
    isError: false,
    filterDetails: {
      statusList, postedAfter, postedBefore, sort,
      platform: queryDetails.platform || undefined,
      watchTargetId: parsePositiveInteger(queryDetails.watchTargetId),
      pageSize: Math.min(parsePositiveInteger(queryDetails.pageSize) ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
      pageOffset: Math.max(0, Number(queryDetails.pageOffset) || 0),
    },
  };
}
