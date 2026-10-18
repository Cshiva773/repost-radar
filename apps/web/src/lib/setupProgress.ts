import type { CreatorProfile, WatchTargetStatus } from './api';
import { formatCount, formatRelativeTime } from './format';

// The three things a new creator sets up before matches can appear, in the order they should do them
export type SetupStepName = 'details' | 'originals' | 'sources';

export interface SetupStepStatus {
  stepName: SetupStepName;
  isDone: boolean;
}

export interface SetupProgressDetails {
  stepList: SetupStepStatus[];
  doneCount: number;
  isComplete: boolean;
  nextStepName: SetupStepName | undefined;
}

export const SETUP_STEP_PATH: Record<SetupStepName, string> = { details: '/settings', originals: '/originals', sources: '/sources' };

// undefined until all three inputs have loaded, so the checklist never flashes on a set-up install
export function buildSetupProgress(creatorProfile: CreatorProfile | undefined, originalCount: number | undefined, watchTargetList: WatchTargetStatus[] | undefined): SetupProgressDetails | undefined {
  if (!creatorProfile || originalCount === undefined || !watchTargetList) return undefined;
  const stepList: SetupStepStatus[] = [
    { stepName: 'details', isDone: creatorProfile.isNoticeReady },
    { stepName: 'originals', isDone: originalCount > 0 },
    // Paused sources check nothing, so at least one must be running
    { stepName: 'sources', isDone: watchTargetList.some((watchTarget) => watchTarget.enabled) },
  ];
  const doneCount = stepList.filter((setupStep) => setupStep.isDone).length;
  return { stepList, doneCount, isComplete: doneCount === stepList.length, nextStepName: stepList.find((setupStep) => !setupStep.isDone)?.stepName };
}

// "Watching 3 sources, last checked 2 min ago." for an empty queue, so a working setup doesn't look broken
export function describeWatching(watchTargetList: WatchTargetStatus[], nowMs: number = Date.now()): string {
  const enabledTargetList = watchTargetList.filter((watchTarget) => watchTarget.enabled);
  const watchingText = `Watching ${formatCount(enabledTargetList.length, 'source', 'sources')}`;
  const lastCrawledMs = Math.max(...enabledTargetList.map((watchTarget) => (watchTarget.lastCrawledAt ? Date.parse(watchTarget.lastCrawledAt) : 0)), 0);
  if (lastCrawledMs === 0) return `${watchingText}. The first check runs within a few minutes.`;
  return `${watchingText}, last checked ${formatRelativeTime(new Date(lastCrawledMs).toISOString(), nowMs)}.`;
}
