import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ConfidenceBadge, StatusBadge } from '../components/CandidateBadges';
import { ClaimWarnings } from '../components/ClaimWarnings';
import { DecisionPanel } from '../components/DecisionPanel';
import { EvidencePanel } from '../components/EvidencePanel';
import { assetQueryKey, OwnershipProofCard } from '../components/OwnershipProof';
import { Badge, Card, Message } from '../components/ui';
import {
  ApiError, apiRequest, buildCandidateQuery, candidateImageUrl, sendJson,
  type AssetSummary, type CandidateDetails, type CandidatePage as CandidatePageResponse, type CreatorProfile, type DecisionAction,
} from '../lib/api';
import { findClaimWarnings } from '../lib/claimWarnings';
import { formatAuthor, formatTarget, formatTimestamp, platformDisplayName, statusLabel } from '../lib/format';
import { QUEUE_DEFINITIONS, type QueueName } from './QueuePage';

const OPEN_STATUS_LIST = ['pending', 'escalated'];

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-1 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function ImagePair({ candidate }: { candidate: CandidateDetails }) {
  const panelList = [
    { imageRole: 'original' as const, label: 'Your original' },
    { imageRole: 'candidate' as const, label: `Found on ${platformDisplayName(candidate.platform)}` },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {panelList.map((panel) => (
        <Card key={panel.imageRole} className="overflow-hidden">
          <p className="border-b border-line px-3 py-2 text-xs font-medium text-ink-muted">{panel.label}</p>
          {candidate.status === 'removed' && panel.imageRole === 'candidate' ? (
            <div className="flex h-[min(60vh,32rem)] items-center justify-center bg-surface-muted px-4 text-center text-sm text-ink-muted">Removed from the platform; the stored copy was deleted.</div>
          ) : (
            <a href={candidateImageUrl(candidate.candidateId, panel.imageRole)} target="_blank" rel="noreferrer">
              <img src={candidateImageUrl(candidate.candidateId, panel.imageRole)} alt={panel.label} className="h-[min(60vh,32rem)] w-full bg-surface-muted object-contain" />
            </a>
          )}
        </Card>
      ))}
    </div>
  );
}

function MatchDetails({ candidate }: { candidate: CandidateDetails }) {
  return (
    <Card className="p-4">
      <dl>
        <DetailRow label="Confidence"><ConfidenceBadge confidence={candidate.confidence} /></DetailRow>
        <DetailRow label="PDQ distance">{candidate.hashDistance ?? '—'} / 256 <span className="text-ink-muted">(≤ 31 is a near-certain copy)</span></DetailRow>
        <DetailRow label="CLIP similarity">{candidate.embedSimilarity?.toFixed(3) ?? '—'}</DetailRow>
        <DetailRow label="Post"><a className="text-accent underline" href={candidate.postUrl} target="_blank" rel="noreferrer noopener">{candidate.postTitle ?? candidate.postUrl}</a></DetailRow>
        <DetailRow label="Where">{formatTarget(candidate.platform, candidate.targetName)} on {platformDisplayName(candidate.platform)}</DetailRow>
        <DetailRow label="Posted by">{formatAuthor(candidate.platform, candidate.postAuthor)}</DetailRow>
        <DetailRow label="Posted">{formatTimestamp(candidate.postedAt)}</DetailRow>
        <DetailRow label="Found">{formatTimestamp(candidate.createdAt)}</DetailRow>
      </dl>
    </Card>
  );
}

function DecisionHistory({ candidate }: { candidate: CandidateDetails }) {
  if (!candidate.decisionList.length) return null;
  return (
    <Card className="p-4">
      <h2 className="mb-2 text-sm font-semibold">History</h2>
      <ol className="flex flex-col gap-2 text-sm">
        {candidate.decisionList.map((decision) => (
          <li key={decision.decisionId}>
            <span className="font-medium">{decision.actor}</span> {statusLabel(decision.fromStatus)} → {statusLabel(decision.toStatus)}
            <span className="text-ink-muted"> · {formatTimestamp(decision.decidedAt)}</span>
            {decision.note && <p className="text-ink-muted">“{decision.note}”</p>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

// After a decision, open the next candidate in the queue the reviewer came from, or go back to that queue
async function findNextCandidateId(queueName: QueueName, currentCandidateId: number): Promise<number | undefined> {
  const queueDefinition = QUEUE_DEFINITIONS[queueName];
  const nextPage = await apiRequest<CandidatePageResponse>(buildCandidateQuery({ statusList: [...queueDefinition.statusList], sort: queueDefinition.sort, pageSize: 2, pageOffset: 0 }));
  return nextPage.candidateList.find((candidate) => candidate.candidateId !== currentCandidateId)?.candidateId;
}

export function CandidatePage() {
  const candidateId = Number(useParams().candidateId);
  const [searchParams] = useSearchParams();
  const fromQueue = (searchParams.get('from') ?? 'pending') as QueueName;
  const returnQueue: QueueName = fromQueue in QUEUE_DEFINITIONS ? fromQueue : 'pending';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const candidateQuery = useQuery({ queryKey: ['candidate', candidateId], queryFn: () => apiRequest<CandidateDetails>(`/candidates/${candidateId}`) });
  const profileQuery = useQuery({ queryKey: ['creator'], queryFn: () => apiRequest<CreatorProfile>('/creator') });
  const assetId = candidateQuery.data?.assetId;
  const assetQuery = useQuery({ queryKey: assetQueryKey(assetId ?? 0), queryFn: () => apiRequest<AssetSummary>(`/assets/${assetId}`), enabled: Boolean(assetId) });

  const decisionMutation = useMutation({
    mutationFn: ({ action, note, goodFaith }: { action: DecisionAction; note: string; goodFaith: boolean }) =>
      sendJson<CandidateDetails>(`/candidates/${candidateId}/decision`, 'POST', { action, note: note || undefined, goodFaith }),
    onSuccess: async (updatedCandidate) => {
      queryClient.setQueryData(['candidate', candidateId], updatedCandidate);
      await queryClient.invalidateQueries({ queryKey: ['candidates'] });
      if (updatedCandidate.status === 'approved' || returnQueue === 'decided') return;
      const nextCandidateId = await findNextCandidateId(returnQueue, candidateId);
      navigate(nextCandidateId ? `/candidates/${nextCandidateId}?from=${returnQueue}` : `/queue/${returnQueue}`);
    },
  });

  if (candidateQuery.isPending) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (candidateQuery.error) {
    return <Message tone="danger">{candidateQuery.error instanceof ApiError && candidateQuery.error.statusCode === 404 ? 'This candidate does not exist.' : candidateQuery.error.message}</Message>;
  }
  const candidate = candidateQuery.data;
  const isOpen = OPEN_STATUS_LIST.includes(candidate.status);
  const claimWarningList = findClaimWarnings(candidate.postedAt, assetQuery.data, profileQuery.data?.legalName ?? null);
  const ownPostReason = candidate.isOwnPost
    ? `This post is from one of your own accounts (${formatAuthor(candidate.platform, candidate.postAuthor)}), so it can't be approved. Mark it Legitimate use so it doesn't come back.`
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={`/queue/${returnQueue}`} className="text-sm text-ink-muted hover:text-ink">← {QUEUE_DEFINITIONS[returnQueue].label}</Link>
        <h1 className="text-xl font-semibold">Candidate #{candidate.candidateId}</h1>
        <StatusBadge status={candidate.status} />
        {candidate.isOwnPost && <Badge>Your own post</Badge>}
      </div>
      <ImagePair candidate={candidate} />
      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <div className="flex flex-col gap-4">
          <MatchDetails candidate={candidate} />
          <OwnershipProofCard assetId={candidate.assetId} />
          <DecisionHistory candidate={candidate} />
        </div>
        <div className="flex flex-col gap-4">
          {isOpen && (
            <DecisionPanel canEscalate={candidate.status !== 'escalated'} isSubmitting={decisionMutation.isPending}
              errorMessage={decisionMutation.error?.message} needsProfile={profileQuery.data ? !profileQuery.data.isNoticeReady : false}
              approveBlockedReason={ownPostReason} warningContent={<ClaimWarnings claimWarningList={claimWarningList} assetId={candidate.assetId} />}
              onDecide={(action, note, goodFaith) => decisionMutation.mutate({ action, note, goodFaith })} />
          )}
          {candidate.status === 'approved' && <EvidencePanel candidateId={candidate.candidateId} platform={candidate.platform} />}
          {candidate.status === 'removed' && <Message>The copy was taken down from {platformDisplayName(candidate.platform)}, so there is nothing left to file. Its stored image has been deleted.</Message>}
          {!isOpen && candidate.status !== 'approved' && candidate.status !== 'removed' && <Message>This candidate is closed as {statusLabel(candidate.status).toLowerCase()}.</Message>}
        </div>
      </div>
    </div>
  );
}
