import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, EmptyState, FieldLabel, Message, TextInput } from '../components/ui';
import { apiRequest, sendJson, type PlatformDescription, type WatchTargetStatus } from '../lib/api';
import { formatRelativeTime, formatTarget, platformDisplayName } from '../lib/format';

const INTERVAL_OPTION_LIST = [
  { seconds: 300, label: 'every 5 minutes' },
  { seconds: 900, label: 'every 15 minutes' },
  { seconds: 3600, label: 'every hour' },
  { seconds: 21600, label: 'every 6 hours' },
];
const WATCH_TARGET_QUERY_KEY = ['watch-targets'];

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

function describeSource(watchTarget: WatchTargetStatus): string {
  const scheduleText = watchTarget.enabled ? `every ${Math.round(watchTarget.pollIntervalSeconds / 60)} min` : 'paused';
  const checkedText = watchTarget.lastCrawledAt ? `last checked ${formatRelativeTime(watchTarget.lastCrawledAt)}` : 'not checked yet';
  return `${scheduleText} · ${checkedText} · ${watchTarget.postsSeenCount} images seen · ${watchTarget.candidatesFoundCount} matches`;
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
        <Button variant="danger" onClick={() => window.confirm('Stop watching this source? Matches already found are kept.') && removeMutation.mutate()}>Remove</Button>
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
      {watchTargetQuery.error && <Message tone="danger">{watchTargetQuery.error.message}</Message>}
      <Card>
        {watchTargetQuery.data && watchTargetList.length === 0 && <EmptyState title="Not watching anything yet">Add a subreddit, hashtag or account above.</EmptyState>}
        {watchTargetList.length > 0 && <ul className="divide-y divide-line">{watchTargetList.map((watchTarget) => <SourceRow key={watchTarget.watchTargetId} watchTarget={watchTarget} />)}</ul>}
      </Card>
    </div>
  );
}
