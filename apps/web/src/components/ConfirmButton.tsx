import { useState, type ReactNode } from 'react';
import { Button } from './ui';

interface ConfirmButtonProps {
  label: string;
  question: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  variant?: 'danger' | 'secondary';
  disabled?: boolean;
}

// Confirmation inside the page instead of window.confirm, which embedded browsers and some app views
// cancel silently (the button then appears to do nothing)
export function ConfirmButton({ label, question, confirmLabel, onConfirm, variant = 'danger', disabled = false }: ConfirmButtonProps) {
  const [isAsking, setIsAsking] = useState(false);
  if (!isAsking) return <Button variant={variant} disabled={disabled} onClick={() => setIsAsking(true)}>{label}</Button>;
  return (
    <span role="group" aria-label={label} className="inline-flex flex-wrap items-center gap-2 rounded-md bg-surface-muted px-2 py-1 text-sm">
      <span>{question}</span>
      <Button variant={variant} onClick={() => { setIsAsking(false); onConfirm(); }}>{confirmLabel}</Button>
      <Button variant="ghost" autoFocus onClick={() => setIsAsking(false)}>Keep</Button>
    </span>
  );
}
