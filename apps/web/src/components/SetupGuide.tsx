import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { apiRequest, type AssetPage, type CreatorProfile, type WatchTargetStatus } from '../lib/api';
import { formatCount } from '../lib/format';
import { buildSetupProgress, SETUP_STEP_PATH, type SetupStepName } from '../lib/setupProgress';
import { Card } from './ui';

// Same keys as the Settings, Originals and Sources pages, so the guide shares their cache and updates with them
export const CREATOR_QUERY_KEY = ['creator'];
export const WATCH_TARGET_QUERY_KEY = ['watch-targets'];
const ORIGINAL_COUNT_QUERY_KEY = ['assets', 'count'];

export function useSetupState() {
  const creatorQuery = useQuery({ queryKey: CREATOR_QUERY_KEY, queryFn: () => apiRequest<CreatorProfile>('/creator') });
  const originalCountQuery = useQuery({ queryKey: ORIGINAL_COUNT_QUERY_KEY, queryFn: () => apiRequest<AssetPage>('/assets?pageSize=1&pageOffset=0') });
  const watchTargetQuery = useQuery({ queryKey: WATCH_TARGET_QUERY_KEY, queryFn: () => apiRequest<{ watchTargetList: WatchTargetStatus[] }>('/watch-targets') });
  const creatorProfile = creatorQuery.data;
  const originalCount = originalCountQuery.data?.totalCount;
  const watchTargetList = watchTargetQuery.data?.watchTargetList;
  return { creatorProfile, originalCount, watchTargetList, setupProgress: buildSetupProgress(creatorProfile, originalCount, watchTargetList) };
}

type SetupState = ReturnType<typeof useSetupState>;

interface StepCopy {
  title: string;
  describe: (setupState: SetupState, isDone: boolean) => string;
  actionLabel: (isDone: boolean) => string;
  nextText: string;
}

const STEP_COPY: Record<SetupStepName, StepCopy> = {
  details: {
    title: 'Your details',
    describe: ({ creatorProfile }, isDone) => (isDone ? `${creatorProfile?.legalName}, ${creatorProfile?.contactEmail}. Used to sign your takedown notices.` : 'Your legal name, email and address. A takedown notice must include them.'),
    actionLabel: (isDone) => (isDone ? 'Edit' : 'Add details'),
    nextText: 'Next, add your legal name, email and address.',
  },
  originals: {
    title: 'Your originals',
    describe: ({ originalCount }, isDone) => (isDone ? `${formatCount(originalCount ?? 0, 'original', 'originals')} added.` : 'Upload the photos you want to protect.'),
    actionLabel: (isDone) => (isDone ? 'Add more' : 'Add originals'),
    nextText: 'Next, add the photos you want to protect.',
  },
  sources: {
    title: 'Where to look',
    describe: ({ watchTargetList }, isDone) => {
      if (isDone) return `Watching ${formatCount(watchTargetList?.filter((watchTarget) => watchTarget.enabled).length ?? 0, 'source', 'sources')}.`;
      return watchTargetList?.length ? 'All your sources are paused. Resume one so copies keep being found.' : 'Pick Bluesky accounts, hashtags or subreddits to check for copies.';
    },
    actionLabel: (isDone) => (isDone ? 'Manage' : 'Add a source'),
    nextText: 'Next, choose where to look for copies.',
  },
};

function StepRow({ stepName, isDone, setupState }: { stepName: SetupStepName; isDone: boolean; setupState: SetupState }) {
  const stepCopy = STEP_COPY[stepName];
  const isNext = setupState.setupProgress?.nextStepName === stepName;
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden="true" className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${isDone ? 'border-approve bg-approve text-white dark:text-black' : 'border-line'}`}>{isDone ? '✓' : ''}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{stepCopy.title}<span className="sr-only">{isDone ? ' (done)' : ' (to do)'}</span></p>
        <p className="text-sm text-ink-muted">{stepCopy.describe(setupState, isDone)}</p>
      </div>
      <Link to={SETUP_STEP_PATH[stepName]}
        className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium ${isNext ? 'bg-accent text-accent-ink hover:opacity-90' : 'border border-line bg-surface hover:bg-surface-muted'}`}>
        {stepCopy.actionLabel(isDone)}
      </Link>
    </li>
  );
}

// Shown on Review until details, originals and at least one running source are in place
export function SetupChecklist() {
  const setupState = useSetupState();
  const { setupProgress } = setupState;
  if (!setupProgress || setupProgress.isComplete) return null;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="font-semibold">Set up Repost Radar</h2>
        <p className="text-sm text-ink-muted">{setupProgress.doneCount} of {setupProgress.stepList.length} done. Originals and sources let Repost Radar find copies; your details go on the takedown notices.</p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
        <div className="h-full bg-approve" style={{ width: `${(setupProgress.doneCount / setupProgress.stepList.length) * 100}%` }} />
      </div>
      <ul className="flex flex-col gap-3">
        {setupProgress.stepList.map((setupStep) => <StepRow key={setupStep.stepName} stepName={setupStep.stepName} isDone={setupStep.isDone} setupState={setupState} />)}
      </ul>
    </Card>
  );
}

// After finishing something on a setup page: where to go next, or back to Review once everything is done
export function NextStepNudge({ currentStepName }: { currentStepName: SetupStepName }) {
  const { setupProgress } = useSetupState();
  if (!setupProgress || setupProgress.nextStepName === currentStepName) return null;
  const nextStepName = setupProgress.nextStepName;
  const nudgeText = nextStepName ? STEP_COPY[nextStepName].nextText : "You're set up. Matches appear in Review as copies are found.";
  const linkLabel = nextStepName ? `${STEP_COPY[nextStepName].actionLabel(false)} →` : 'Go to Review →';
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm">
      <span>{nudgeText}</span>
      <Link to={nextStepName ? SETUP_STEP_PATH[nextStepName] : '/queue/pending'} className="font-medium text-accent hover:underline">{linkLabel}</Link>
    </div>
  );
}
