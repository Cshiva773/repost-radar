import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'approve' | 'danger' | 'ghost';

const BUTTON_VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:opacity-90',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-muted',
  approve: 'bg-approve text-white hover:opacity-90 dark:text-black',
  danger: 'bg-surface text-danger border border-line hover:bg-danger-surface',
  ghost: 'text-ink-muted hover:text-ink hover:bg-surface-muted',
};

export function Button({ variant = 'secondary', className = '', ...buttonProps }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 disabled:saturate-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${BUTTON_VARIANT_CLASS[variant]} ${className}`}
      {...buttonProps}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-line bg-surface ${className}`}>{children}</section>;
}

type BadgeTone = 'neutral' | 'high' | 'medium' | 'low' | 'approve' | 'danger' | 'caution';

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-ink-muted',
  high: 'bg-danger-surface text-danger',
  medium: 'bg-caution-surface text-caution',
  low: 'bg-surface-muted text-ink-muted',
  approve: 'bg-approve-surface text-approve',
  danger: 'bg-danger-surface text-danger',
  caution: 'bg-caution-surface text-caution',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${BADGE_TONE_CLASS[tone]}`}>{children}</span>;
}

export function FieldLabel({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

const INPUT_CLASS = 'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-accent';

export function TextInput(inputProps: ComponentProps<'input'>) {
  return <input className={INPUT_CLASS} {...inputProps} />;
}

// ComponentProps includes `ref`, which React 19 passes as an ordinary prop
export function TextArea({ className = '', ...textAreaProps }: ComponentProps<'textarea'>) {
  return <textarea className={`${INPUT_CLASS} ${className}`} {...textAreaProps} />;
}

type MessageTone = 'danger' | 'caution' | 'approve' | 'neutral';

const MESSAGE_TONE_CLASS: Record<MessageTone, string> = {
  danger: 'bg-danger-surface text-danger',
  caution: 'bg-caution-surface text-caution',
  approve: 'bg-approve-surface text-approve',
  neutral: 'bg-surface-muted text-ink-muted',
};

export function Message({ tone = 'neutral', children }: { tone?: MessageTone; children: ReactNode }) {
  return <div role={tone === 'danger' ? 'alert' : 'status'} className={`rounded-md px-3 py-2 text-sm ${MESSAGE_TONE_CLASS[tone]}`}>{children}</div>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-16 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-md text-sm text-ink-muted">{children}</p>}
    </div>
  );
}
