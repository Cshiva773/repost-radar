import { describe, expect, it } from 'vitest';
import { parseCandidateFilters, parseDecisionBody, planDecision } from './candidateRules.js';

describe('parseDecisionBody', () => {
  it('requires the good-faith confirmation to approve', () => {
    expect(parseDecisionBody({ action: 'approve' }).isError).toBe(true);
    expect(parseDecisionBody({ action: 'approve', goodFaith: 'yes' }).isError).toBe(true);
    expect(parseDecisionBody({ action: 'approve', goodFaith: true })).toEqual({ isError: false, decisionInput: { action: 'approve', note: undefined } });
  });

  it('does not need good faith for the other actions, and trims notes', () => {
    expect(parseDecisionBody({ action: 'dismiss', note: '  not mine  ' })).toEqual({ isError: false, decisionInput: { action: 'dismiss', note: 'not mine' } });
    expect(parseDecisionBody({ action: 'escalate', note: '   ' })).toEqual({ isError: false, decisionInput: { action: 'escalate', note: undefined } });
  });

  it('rejects unknown actions, non-text notes and overlong notes', () => {
    expect(parseDecisionBody({ action: 'delete' }).isError).toBe(true);
    expect(parseDecisionBody({ action: 'dismiss', note: 42 }).isError).toBe(true);
    expect(parseDecisionBody({ action: 'dismiss', note: 'x'.repeat(2001) }).isError).toBe(true);
  });
});

describe('planDecision', () => {
  it('moves open candidates to the action status', () => {
    expect(planDecision('pending', 'approve')).toEqual({ isError: false, toStatus: 'approved' });
    expect(planDecision('pending', 'legitimate')).toEqual({ isError: false, toStatus: 'legitimate' });
    expect(planDecision('escalated', 'dismiss')).toEqual({ isError: false, toStatus: 'dismissed' });
  });

  it('returns 409 for closed candidates and for no-op escalations', () => {
    for (const closedStatus of ['approved', 'dismissed', 'legitimate', 'suppressed'] as const) {
      expect(planDecision(closedStatus, 'approve')).toMatchObject({ isError: true, statusCode: 409 });
    }
    expect(planDecision('escalated', 'escalate')).toMatchObject({ isError: true, statusCode: 409 });
  });
});

describe('parseCandidateFilters', () => {
  it('defaults to the pending queue sorted by confidence', () => {
    const parseResult = parseCandidateFilters({});
    expect(parseResult).toMatchObject({ isError: false, filterDetails: { statusList: ['pending'], sort: 'confidence', pageSize: 25, pageOffset: 0 } });
  });

  it('parses status lists, dates, target and caps the page size', () => {
    const parseResult = parseCandidateFilters({ status: 'approved,dismissed', postedAfter: '2026-10-01', watchTargetId: '7', pageSize: '500', sort: 'newest' });
    expect(parseResult.isError).toBe(false);
    if (parseResult.isError) return;
    expect(parseResult.filterDetails).toMatchObject({ statusList: ['approved', 'dismissed'], watchTargetId: 7, pageSize: 100, sort: 'newest' });
    expect(parseResult.filterDetails.postedAfter?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('rejects unknown statuses and bad dates', () => {
    expect(parseCandidateFilters({ status: 'pending,open' }).isError).toBe(true);
    expect(parseCandidateFilters({ postedBefore: 'yesterday' }).isError).toBe(true);
  });
});
