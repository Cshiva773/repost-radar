import { useEffect, useRef, useState } from 'react';
import { Button, Message } from './ui';

interface ApproveDialogProps {
  isOpen: boolean;
  isSubmitting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

// PRD legal guardrail: approval is the only path to a notice, so it is gated on an explicit good-faith statement
export function ApproveDialog({ isOpen, isSubmitting, onConfirm, onClose }: ApproveDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isGoodFaithConfirmed, setIsGoodFaithConfirmed] = useState(false);

  useEffect(() => {
    const dialogElement = dialogRef.current;
    if (!dialogElement) return;
    if (isOpen && !dialogElement.open) {
      setIsGoodFaithConfirmed(false);
      dialogElement.showModal();
    }
    if (!isOpen && dialogElement.open) dialogElement.close();
  }, [isOpen]);

  return (
    <dialog ref={dialogRef} onClose={onClose} aria-labelledby="approve-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/50">
      <div className="flex flex-col gap-4 p-5">
        <h2 id="approve-title" className="text-lg font-semibold">Approve as an infringing copy?</h2>
        <p className="text-sm text-ink-muted">
          Approving builds an evidence pack and a takedown notice for you to file yourself. Nothing is sent to the platform.
        </p>
        <Message tone="caution">
          <strong>17 U.S.C. §512(f):</strong> anyone who knowingly misrepresents that material is infringing can be liable for damages,
          including the other side's costs and attorney's fees. Approve only if this is your work, the use is not authorised, and you
          have considered whether it could be fair use.
        </Message>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--approve)]" checked={isGoodFaithConfirmed}
            onChange={(changeEvent) => setIsGoodFaithConfirmed(changeEvent.target.checked)} />
          <span>I have a good-faith belief that this use is not authorised by me, my agent, or the law, and I have considered fair use.</span>
        </label>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="approve" disabled={!isGoodFaithConfirmed || isSubmitting} onClick={onConfirm}>
            {isSubmitting ? 'Approving…' : 'Approve and build pack'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
