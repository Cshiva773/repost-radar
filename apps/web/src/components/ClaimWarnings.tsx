import { Link } from 'react-router';
import type { ClaimWarning, ProofSource } from '../lib/claimWarnings';
import { formatTimestamp } from '../lib/format';
import { formatProofDate } from '../lib/ownershipProof';
import { Message } from './ui';

const SOURCE_LABEL: Record<ProofSource, string> = {
  firstPublished: 'your first-published date',
  fileTakenAt: "the file's date taken",
  uploaded: 'when you added it here',
};

function WarningText({ claimWarning, assetId }: { claimWarning: ClaimWarning; assetId: number }) {
  if (claimWarning.kind === 'fileNamesSomeoneElse') {
    return <>The original file's metadata names <strong>{claimWarning.fileArtist}</strong> as its author, not you ({claimWarning.legalName}).</>;
  }
  // Same day (only possible against the exact upload time): show times, or the two dates would read as equal
  const isSameDay = claimWarning.postedOn === claimWarning.earliestProof.provenOn;
  const postedText = isSameDay ? formatTimestamp(new Date(claimWarning.postedAtMs).toISOString()) : formatProofDate(claimWarning.postedOn);
  const provenText = isSameDay ? formatTimestamp(new Date(claimWarning.earliestProof.provenAtMs).toISOString()) : formatProofDate(claimWarning.earliestProof.provenOn);
  return (
    <>
      <strong>This post ({postedText}) is older than any proof that you published this photo first.</strong>{' '}
      The earliest is {SOURCE_LABEL[claimWarning.earliestProof.source]}, {provenText}.
      Approve only if you can show you created it, or <Link className="underline" to={`/originals?proof=${assetId}`}>add proof to the original</Link>.
    </>
  );
}

// Shown on the match page and again inside the approve dialog
export function ClaimWarnings({ claimWarningList, assetId }: { claimWarningList: ClaimWarning[]; assetId: number }) {
  if (!claimWarningList.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {claimWarningList.map((claimWarning) => (
        <Message key={claimWarning.kind} tone="caution"><WarningText claimWarning={claimWarning} assetId={assetId} /></Message>
      ))}
    </div>
  );
}
