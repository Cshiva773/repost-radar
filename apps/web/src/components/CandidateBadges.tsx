import type { CandidateStatus } from '../lib/api';
import { confidenceTone, formatConfidence, statusLabel } from '../lib/format';
import { Badge } from './ui';

const STATUS_TONE: Record<CandidateStatus, 'neutral' | 'approve' | 'danger' | 'caution'> = {
  suppressed: 'neutral', pending: 'caution', approved: 'approve', dismissed: 'neutral', legitimate: 'neutral', escalated: 'caution',
};

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  return <Badge tone={confidenceTone(confidence)}><span title="Match confidence">{formatConfidence(confidence)}</span></Badge>;
}

export function StatusBadge({ status }: { status: CandidateStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{statusLabel(status)}</Badge>;
}
