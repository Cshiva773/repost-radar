import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ConfirmButton } from '../components/ConfirmButton';
import { Badge, Button, Card, EmptyState, FieldLabel, Message, TextInput } from '../components/ui';
import { apiRequest, sendJson, type PlatformDescription, type SourceSuggestion, type WatchTargetStatus } from '../lib/api';
import { formatCount, formatRelativeTime, formatTarget, platformDisplayName } from '../lib/format';

const INTERVAL_OPTION_LIST = [
  { seconds: 300, label: 'every 5 minutes' },
  { seconds: 900, label: 'every 15 minutes' },
  { seconds: 3600, label: 'every hour' },
  { seconds: 21600, label: 'every 6 hours' },
];
const WATCH_TARGET_QUERY_KEY = ['watch-targets'];
const SUGGESTION_QUERY_KEY = ['watch-target-suggestions'];
const SUGGESTED_POLL_INTERVAL_SECONDS = 900;

function AddSourceForm({ platformList }: { platformList: PlatformDescription[] }) {
  const queryClient = useQueryClient();
  const [platformName, setPlatformName] = useState(platformList[0]?.platformName ?? 'reddit');
  const [targetText, setTargetText] = useState('');
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState(900);
  const selectedPlatform = platformList.find((platform) => platform.platformName === platformName);
  const addMutation = useMutation({
    mutationFn: () => sendJson<WatchTargetStatus>('/watch-targets', 'POST', { platform: platformName, target: targetText, pollIntervalSeconds }),
    onSuccess: async () => { setTargetText(''); await queryClient.invalidateQueries({ queryKey: WATCH_TARGET_QUERY_KEY }); },
  });
  const submitSource = (formEvent: FormEvent) => { formEvent.preventDefault(); addMutation.mutate(); };

  return (
    <Card className="p-4">
      <form className="grid gap-3 sm:grid-cols-[10rem_1fr_11rem_auto] sm:items-end" onSubmit={submitSource}>
        <FieldLabel label="Platform">
          <select className="rounded-md border border-line bg-surface px-2 py-2 text-sm" value={platformName} onChange={(changeEvent) => setPlatformName(changeEvent.target.value)}>
            {platformList.map((platform) => <option key={platform.platformName} value={platform.platformName}>{platform.displayName}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label={selectedPlatform ? selectedPlatform.targetLabel.replace(/^\w/, (firstLetter) => firstLetter.toUpperCase()) : 'Target'}>
          <TextInput value={targetText} placeholder={selectedPlatform?.targetExample} onChange={(changeEvent) => setTargetText(changeEvent.target.value)} required />
        </FieldLabel>
        <FieldLabel label="Check">
          <select className="rounded-md border border-line bg-surface px-2 py-2 text-sm" value={pollIntervalSeconds} onChange={(changeEvent) => setPollIntervalSeconds(Number(changeEvent.target.value))}>
            {INTERVAL_OPTION_LIST.map((intervalOption) => <option key={intervalOption.seconds} value={intervalOption.seconds}>{intervalOption.label}</option>)}
          </select>
        </FieldLabel>
        <Button variant="primary" type="submit" disabled={addMutation.isPending}>Watch</Button>
      </form>
      {addMutation.error && <div className="mt-3"><Message tone="danger">{addMutation.error.message}</Message></div>}
      <p className="mt-3 text-xs text-ink-muted">Only places you name are crawled; there are no site-wide sweeps. A new source backfills up to 1,000 posts or 7 days.</p>
    </Card>
  );
}

// Places that posts matching your work point to (crosspost subreddits, hashtags). Nothing is crawled until you add one.
function SuggestionsCard() {
  const queryClient = useQueryClient();
  const suggestionQuery = useQuery({ queryKey: SUGGESTION_QUERY_KEY, queryFn: () => apiRequest<{ suggestionList: SourceSuggestion[] }>('/watch-target-suggestions') });
  const watchMutation = useMutation({
    mutationFn: (suggestion: SourceSuggestion) => sendJson('/watch-targets', 'POST', { platform: suggestion.platform, target: suggestion.targetName, pollIntervalSeconds: SUGGESTED_POLL_INTERVAL_SECONDS }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: WATCH_TARGET_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: SUGGESTION_QUERY_KEY });
    },
  });
  const suggestionList = suggestionQuery.data?.suggestionList ?? [];
  if (suggestionList.length === 0) return null;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="font-semibold">Suggested from your matches</h2>
        <p className="text-sm text-ink-muted">Matched posts were crossposted to or tagged with these. Nothing is crawled unless you add it.</p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {suggestionList.map((suggestion) => (
          <li key={`${suggestion.platform}:${suggestion.targetName}`} className="flex items-center gap-2 rounded-md border border-line px-2 py-1 text-sm">
            <a href={suggestion.targetUrl} target="_blank" rel="noreferrer noopener" className="font-medium hover:underline">{formatTarget(suggestion.platform, suggestion.targetName)}</a>
            <span className="text-xs text-ink-muted">{platformDisplayName(suggestion.platform)} · {formatCount(suggestion.matchCount, 'match', 'matches')}</span>
            <Button variant="ghost" className="px-2 py-1" disabled={watchMutation.isPending} onClick={() => watchMutation.mutate(suggestion)}>Watch</Button>
          </li>
        ))}
      </ul>
      {watchMutation.error && <Message tone="danger">{watchMutation.error.message}</Message>}
    </Card>
  );
}

function describeSource(watchTarget: WatchTargetStatus): string {
  const scheduleText = watchTarget.enabled ? `every ${Math.round(watchTarget.pollIntervalSeconds / 60)} min` : 'paused';
  const checkedText = watchTarget.lastCrawledAt ? `last checked ${formatRelativeTime(watchTarget.lastCrawledAt)}` : 'not checked yet';
  // A first check that finds nothing usually means no image posts in the 7-day backfill window, not a fault
  const seenText = watchTarget.lastCrawledAt && watchTarget.postsSeenCount === 0 ? 'no image posts in the last 7 days' : formatCount(watchTarget.postsSeenCount, 'image seen', 'images seen');
  return `${scheduleText} · ${checkedText} · ${seenText} · ${formatCount(watchTarget.candidatesFoundCount, 'match', 'matches')}`;
}

function SourceRow({ watchTarget }: { watchTarget: WatchTargetStatus }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: WATCH_TARGET_QUERY_KEY });
  const toggleMutation = useMutation({ mutationFn: () => sendJson(`/watch-targets/${watchTarget.watchTargetId}`, 'PATCH', { enabled: !watchTarget.enabled }), onSuccess: refresh });
  const removeMutation = useMutation({ mutationFn: () => apiRequest(`/watch-targets/${watchTarget.watchTargetId}`, { method: 'DELETE' }), onSuccess: refresh });
  const mutationError = toggleMutation.error ?? removeMutation.error;
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{formatTarget(watchTarget.platform, watchTarget.targetName)} <span className="text-sm font-normal text-ink-muted">on {platformDisplayName(watchTarget.platform)}</span></p>
          <p className="text-xs text-ink-muted">{describeSource(watchTarget)}</p>
        </div>
        {watchTarget.lastError ? <Badge tone="danger">Error</Badge> : !watchTarget.enabled && <Badge>Paused</Badge>}
        <Button onClick={() => toggleMutation.mutate()} disabled={toggleMutation.isPending}>{watchTarget.enabled ? 'Pause' : 'Resume'}</Button>
        <ConfirmButton label="Remove" question="Stop watching? Matches already found are kept." confirmLabel="Yes, remove" onConfirm={() => removeMutation.mutate()} />
      </div>
      {watchTarget.lastError && <Message tone="danger">Last crawl failed: {watchTarget.lastError}</Message>}
      {mutationError && <Message tone="danger">{mutationError.message}</Message>}
    </li>
  );
}

export function SourcesPage() {
  const platformQuery = useQuery({ queryKey: ['platforms'], queryFn: () => apiRequest<{ platformList: PlatformDescription[] }>('/platforms'), staleTime: Infinity });
  const watchTargetQuery = useQuery({ queryKey: WATCH_TARGET_QUERY_KEY, queryFn: () => apiRequest<{ watchTargetList: WatchTargetStatus[] }>('/watch-targets'), refetchInterval: 30_000 });
  const watchTargetList = watchTargetQuery.data?.watchTargetList ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Sources</h1>
        <p className="text-sm text-ink-muted">Communities, hashtags and accounts the crawler checks for copies of your originals.</p>
      </div>
      {platformQuery.data && <AddSourceForm platformList={platformQuery.data.platformList} />}
      <SuggestionsCard />
      {watchTargetQuery.error && <Message tone="danger">{watchTargetQuery.error.message}</Message>}
      <Card>
        {watchTargetQuery.data && watchTargetList.length === 0 && <EmptyState title="Not watching anything yet">Add a subreddit, hashtag or account above.</EmptyState>}
        {watchTargetList.length > 0 && <ul className="divide-y divide-line">{watchTargetList.map((watchTarget) => <SourceRow key={watchTarget.watchTargetId} watchTarget={watchTarget} />)}</ul>}
      </Card>
    </div>
  );
}
