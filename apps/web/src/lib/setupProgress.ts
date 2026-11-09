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

// The first unfinished step other than the one the creator is on, so a half-finished step never leaves them stuck
export function findNextStepAfter(setupProgress: SetupProgressDetails, currentStepName: SetupStepName): SetupStepName | undefined {
  return setupProgress.stepList.find((setupStep) => !setupStep.isDone && setupStep.stepName !== currentStepName)?.stepName;
}

// What a notice still needs from Settings, in the words the form uses
export function listMissingNoticeFields(creatorProfile: Pick<CreatorProfile, 'legalName' | 'contactEmail' | 'mailingAddress'>): string[] {
  const fieldList: [string | null, string][] = [
    [creatorProfile.legalName, 'legal name'], [creatorProfile.contactEmail, 'contact email'], [creatorProfile.mailingAddress, 'mailing address'],
  ];
  return fieldList.filter(([fieldValue]) => !fieldValue?.trim()).map(([, fieldLabel]) => fieldLabel);
}

// "legal name and mailing address", "legal name, contact email and mailing address"
export function joinWithAnd(wordList: string[]): string {
  if (wordList.length <= 1) return wordList.join('');
  return `${wordList.slice(0, -1).join(', ')} and ${wordList.at(-1)}`;
}

// "Watching 3 sources, last checked 2 min ago." for an empty queue, so a working setup doesn't look broken
export function describeWatching(watchTargetList: WatchTargetStatus[], nowMs: number = Date.now()): string {
  const enabledTargetList = watchTargetList.filter((watchTarget) => watchTarget.enabled);
  const watchingText = `Watching ${formatCount(enabledTargetList.length, 'source', 'sources')}`;
  const lastCrawledMs = Math.max(...enabledTargetList.map((watchTarget) => (watchTarget.lastCrawledAt ? Date.parse(watchTarget.lastCrawledAt) : 0)), 0);
  if (lastCrawledMs === 0) return `${watchingText}. The first check runs within a few minutes.`;
  return `${watchingText}, last checked ${formatRelativeTime(new Date(lastCrawledMs).toISOString(), nowMs)}.`;
}
