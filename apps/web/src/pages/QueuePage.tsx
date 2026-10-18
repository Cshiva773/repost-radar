import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, NavLink, useParams } from 'react-router';
import { ConfidenceBadge, StatusBadge } from '../components/CandidateBadges';
import { SetupChecklist, useSetupState } from '../components/SetupGuide';
import { Badge, Button, Card, EmptyState, Message } from '../components/ui';
import { apiRequest, buildCandidateQuery, candidateImageUrl, type CandidatePage, type CandidateQueryDetails, type CandidateSummary, type PlatformDescription } from '../lib/api';
import { formatAuthor, formatRelativeTime, formatTarget, platformDisplayName } from '../lib/format';
import { describeWatching } from '../lib/setupProgress';

const PAGE_SIZE = 25;

export const QUEUE_DEFINITIONS = {
  pending: { label: 'Pending', statusList: ['pending'], sort: 'confidence', empty: 'Nothing to review. New matches appear here as the crawler finds them.' },
  escalated: { label: 'Second look', statusList: ['escalated'], sort: 'newest', empty: 'No escalated matches.' },
  decided: { label: 'Decided', statusList: ['approved', 'dismissed', 'legitimate', 'removed'], sort: 'newest', empty: 'No decisions yet.' },
} as const satisfies Record<string, { label: string; statusList: CandidateQueryDetails['statusList']; sort: 'confidence' | 'newest'; empty: string }>;

export type QueueName = keyof typeof QUEUE_DEFINITIONS;

function isQueueName(rawName: string | undefined): rawName is QueueName {
  return rawName !== undefined && rawName in QUEUE_DEFINITIONS;
}

function CandidateRow({ candidate, queueName }: { candidate: CandidateSummary; queueName: QueueName }) {
  return (
    <li>
      <Link to={`/candidates/${candidate.candidateId}?from=${queueName}`} className="flex items-center gap-4 px-4 py-3 hover:bg-surface-muted">
        <div className="flex shrink-0 gap-1">
          {(['original', 'candidate'] as const).map((imageRole) => (
            <img key={imageRole} src={candidateImageUrl(candidate.candidateId, imageRole)} alt={imageRole === 'original' ? 'Your original' : 'Found copy'}
              loading="lazy" className="h-14 w-14 rounded border border-line bg-surface-muted object-cover" />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <ConfidenceBadge confidence={candidate.confidence} />
            {queueName !== 'pending' && <StatusBadge status={candidate.status} />}
            {candidate.isOwnPost && <Badge>Your own post</Badge>}
            <span className="truncate text-sm font-medium">{candidate.postTitle ?? `${platformDisplayName(candidate.platform)} post`}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-muted">
            {formatTarget(candidate.platform, candidate.targetName)} · {formatAuthor(candidate.platform, candidate.postAuthor)} · posted {formatRelativeTime(candidate.postedAt)}
          </p>
        </div>
        <span className="hidden text-xs text-ink-muted sm:block">#{candidate.candidateId}</span>
      </Link>
    </li>
  );
}

// The empty Pending queue says what is being watched, so a working setup doesn't look the same as a broken one
function PendingEmptyState() {
  const { setupProgress, watchTargetList } = useSetupState();
  if (!setupProgress || !watchTargetList) return <EmptyState title="Nothing to review yet." />;
  if (!setupProgress.isComplete) return <EmptyState title="Nothing to review yet.">Finish setting up above and matches will appear here.</EmptyState>;
  return <EmptyState title="Nothing to review yet.">{describeWatching(watchTargetList)} New matches appear here as copies are found.</EmptyState>;
}

function QueueTabs({ activeQueue }: { activeQueue: QueueName }) {
  return (
    <div className="flex gap-1 border-b border-line" role="tablist">
      {(Object.keys(QUEUE_DEFINITIONS) as QueueName[]).map((queueName) => (
        <NavLink key={queueName} to={`/queue/${queueName}`} role="tab" aria-selected={queueName === activeQueue}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${queueName === activeQueue ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>
          {QUEUE_DEFINITIONS[queueName].label}
        </NavLink>
      ))}
    </div>
  );
}

export function QueuePage() {
  const { queueName: rawQueueName } = useParams();
  const queueName: QueueName = isQueueName(rawQueueName) ? rawQueueName : 'pending';
  const queueDefinition = QUEUE_DEFINITIONS[queueName];
  const [platformFilter, setPlatformFilter] = useState('');
  const [pageOffset, setPageOffset] = useState(0);
  const platformQuery = useQuery({ queryKey: ['platforms'], queryFn: () => apiRequest<{ platformList: PlatformDescription[] }>('/platforms'), staleTime: Infinity });
  const queryDetails: CandidateQueryDetails = { statusList: [...queueDefinition.statusList], sort: queueDefinition.sort, platform: platformFilter || undefined, pageSize: PAGE_SIZE, pageOffset };
  const candidateQuery = useQuery({ queryKey: ['candidates', queryDetails], queryFn: () => apiRequest<CandidatePage>(buildCandidateQuery(queryDetails)), placeholderData: keepPreviousData });
  const candidatePage = candidateQuery.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Review</h1>
          <p className="text-sm text-ink-muted">Matches above the review threshold, highest confidence first. Nothing is sent anywhere until you export it.</p>
        </div>
        <select aria-label="Platform" value={platformFilter} onChange={(changeEvent) => { setPlatformFilter(changeEvent.target.value); setPageOffset(0); }}
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm">
          <option value="">All platforms</option>
          {platformQuery.data?.platformList.map((platform) => <option key={platform.platformName} value={platform.platformName}>{platform.displayName}</option>)}
        </select>
      </div>
      {queueName === 'pending' && <SetupChecklist />}
      <QueueTabs activeQueue={queueName} />
      {candidateQuery.error && <Message tone="danger">{candidateQuery.error.message}</Message>}
      <Card>
        {candidatePage && candidatePage.candidateList.length === 0 && (queueName === 'pending' && !platformFilter ? <PendingEmptyState /> : <EmptyState title={queueDefinition.empty} />)}
        {candidatePage && candidatePage.candidateList.length > 0 && (
          <ul className="divide-y divide-line">
            {candidatePage.candidateList.map((candidate) => <CandidateRow key={candidate.candidateId} candidate={candidate} queueName={queueName} />)}
          </ul>
        )}
        {!candidatePage && candidateQuery.isPending && <p className="p-4 text-sm text-ink-muted">Loading…</p>}
      </Card>
      {candidatePage && candidatePage.totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-ink-muted">
          <span>{pageOffset + 1}–{Math.min(pageOffset + PAGE_SIZE, candidatePage.totalCount)} of {candidatePage.totalCount}</span>
          <div className="flex gap-2">
            <Button disabled={pageOffset === 0} onClick={() => setPageOffset(Math.max(0, pageOffset - PAGE_SIZE))}>Previous</Button>
            <Button disabled={pageOffset + PAGE_SIZE >= candidatePage.totalCount} onClick={() => setPageOffset(pageOffset + PAGE_SIZE)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
