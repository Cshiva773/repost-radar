import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { DecisionAction } from '../lib/api';
import { ApproveDialog } from './ApproveDialog';
import { Button, Card, Message, TextArea } from './ui';

const ACTION_BUTTON_LIST: { action: DecisionAction; label: string; shortcut: string; hint: string }[] = [
  { action: 'approve', label: 'Approve', shortcut: 'a', hint: 'My work, reposted without permission' },
  { action: 'dismiss', label: 'Dismiss', shortcut: 'd', hint: 'Not a copy' },
  { action: 'legitimate', label: 'Legitimate use', shortcut: 'l', hint: 'My work, but the reuse is allowed; never show this image again' },
  { action: 'escalate', label: 'Second look', shortcut: 'e', hint: 'Unsure; move to the second-look list' },
];
const BUTTON_VARIANT_BY_ACTION = { approve: 'approve', dismiss: 'secondary', legitimate: 'secondary', escalate: 'secondary' } as const;

interface DecisionPanelProps {
  canEscalate: boolean;
  isSubmitting: boolean;
  errorMessage: string | undefined;
  needsProfile: boolean;
  /** Set when approving is not allowed at all (the post is the creator's own); the server refuses it too */
  approveBlockedReason?: string;
  /** Shown above the buttons and again in the approve dialog */
  warningContent?: ReactNode;
  onDecide: (action: DecisionAction, note: string, goodFaith: boolean) => void;
}

function isTypingTarget(eventTarget: EventTarget | null): boolean {
  return eventTarget instanceof HTMLElement && (eventTarget.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(eventTarget.tagName));
}

export function DecisionPanel({ canEscalate, isSubmitting, errorMessage, needsProfile, approveBlockedReason, warningContent, onDecide }: DecisionPanelProps) {
  const [note, setNote] = useState('');
  const [isApproveOpen, setIsApproveOpen] = useState(false);
  const availableActionList = ACTION_BUTTON_LIST.filter((actionButton) => canEscalate || actionButton.action !== 'escalate');
  const isActionDisabled = (action: DecisionAction) => isSubmitting || (action === 'approve' && Boolean(approveBlockedReason));

  const requestAction = (action: DecisionAction) => {
    if (isActionDisabled(action)) return;
    if (action === 'approve') setIsApproveOpen(true);
    else onDecide(action, note, false);
  };

  useEffect(() => {
    const handleShortcut = (keyEvent: KeyboardEvent) => {
      if (isApproveOpen || isSubmitting || keyEvent.metaKey || keyEvent.ctrlKey || keyEvent.altKey || isTypingTarget(keyEvent.target)) return;
      const matchedButton = availableActionList.find((actionButton) => actionButton.shortcut === keyEvent.key.toLowerCase());
      if (!matchedButton) return;
      keyEvent.preventDefault();
      requestAction(matchedButton.action);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  });

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold">Your decision</h2>
      {approveBlockedReason && <Message tone="caution">{approveBlockedReason}</Message>}
      {!approveBlockedReason && warningContent}
      <TextArea rows={2} placeholder="Note (optional): why you decided this" value={note} maxLength={2000} onChange={(changeEvent) => setNote(changeEvent.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        {availableActionList.map((actionButton) => (
          <Button key={actionButton.action} variant={BUTTON_VARIANT_BY_ACTION[actionButton.action]} title={actionButton.hint} disabled={isActionDisabled(actionButton.action)}
            onClick={() => requestAction(actionButton.action)}>
            {actionButton.label} <kbd>{actionButton.shortcut.toUpperCase()}</kbd>
          </Button>
        ))}
      </div>
      {needsProfile && (
        <Message tone="caution">Approving needs your legal name, email and address for the notice. <Link className="underline" to="/settings">Add them in Settings</Link>.</Message>
      )}
      {errorMessage && <Message tone="danger">{errorMessage}</Message>}
      <ApproveDialog isOpen={isApproveOpen} isSubmitting={isSubmitting} warningContent={warningContent} onClose={() => setIsApproveOpen(false)}
        onConfirm={() => { setIsApproveOpen(false); onDecide('approve', note, true); }} />
    </Card>
  );
}
