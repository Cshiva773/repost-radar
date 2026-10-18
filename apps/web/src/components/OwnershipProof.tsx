import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { apiRequest, assetImageUrl, sendJson, type AssetSummary, type CreatorProfile, type OwnershipProofInput } from '../lib/api';
import { compareArtistWithLegalName, formatFileTakenAt, formatProofDate, hasStatedProof } from '../lib/ownershipProof';
import { CREATOR_QUERY_KEY } from './SetupGuide';
import { Button, Card, FieldLabel, Message, TextArea, TextInput } from './ui';

const MAX_NOTE_LENGTH = 1000;

export function assetQueryKey(assetId: number) {
  return ['asset', assetId];
}

function useCreatorProfile() {
  return useQuery({ queryKey: CREATOR_QUERY_KEY, queryFn: () => apiRequest<CreatorProfile>('/creator') }).data;
}

function ProofRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 py-0.5 text-sm sm:grid-cols-[8rem_1fr]">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

// What the original's own file says: read by the worker, never editable here
function FileMetadataRows({ asset, legalName }: { asset: AssetSummary; legalName: string | null }) {
  const artistComparison = compareArtistWithLegalName(asset.exifArtist, legalName);
  if (!asset.exifTakenAt && !asset.exifArtist && !asset.exifCopyright) {
    return <p className="text-sm text-ink-muted">{asset.isFingerprinted ? 'No date or author in the file (common for screenshots and photos downloaded from social media).' : 'Read once the image is processed.'}</p>;
  }
  return (
    <dl>
      <ProofRow label="Date taken">{formatFileTakenAt(asset.exifTakenAt) ?? '—'}</ProofRow>
      <ProofRow label="Artist">
        {asset.exifArtist ?? '—'}
        {artistComparison === 'matches' && <span className="text-approve"> · matches your legal name</span>}
        {artistComparison === 'differs' && <span className="text-caution"> · not your legal name ({legalName})</span>}
      </ProofRow>
      <ProofRow label="Copyright">{asset.exifCopyright ?? '—'}</ProofRow>
    </dl>
  );
}

function StatedProofRows({ asset }: { asset: AssetSummary }) {
  if (!hasStatedProof(asset)) return <p className="text-sm text-ink-muted">Nothing added yet.</p>;
  return (
    <dl>
      <ProofRow label="First published">
        {asset.firstPublishedUrl ? <a className="text-accent underline" href={asset.firstPublishedUrl} target="_blank" rel="noreferrer noopener">{asset.firstPublishedUrl}</a> : '—'}
        {asset.firstPublishedOn && <span> on {formatProofDate(asset.firstPublishedOn)}</span>}
      </ProofRow>
      {asset.ownershipNote && <ProofRow label="Note">{asset.ownershipNote}</ProofRow>}
    </dl>
  );
}

// On a match page: the proof behind "this is my photo", next to the original
export function OwnershipProofCard({ assetId }: { assetId: number }) {
  const assetQuery = useQuery({ queryKey: assetQueryKey(assetId), queryFn: () => apiRequest<AssetSummary>(`/assets/${assetId}`) });
  const creatorProfile = useCreatorProfile();
  const asset = assetQuery.data;
  if (!asset) return null;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Your proof for original #{asset.assetId}</h2>
        <Link to={`/originals?proof=${asset.assetId}`} className="text-sm font-medium text-accent hover:underline">{hasStatedProof(asset) ? 'Edit proof' : 'Add proof'}</Link>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Stated by you</p>
        <StatedProofRows asset={asset} />
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">From the file</p>
        <FileMetadataRows asset={asset} legalName={creatorProfile?.legalName ?? null} />
      </div>
      <p className="text-xs text-ink-muted">Repost Radar doesn't verify any of this. It goes into the evidence pack and notice as your own statement and as what the file says.</p>
    </Card>
  );
}

function toProofInput(asset: AssetSummary): OwnershipProofInput {
  return { firstPublishedUrl: asset.firstPublishedUrl ?? '', firstPublishedOn: asset.firstPublishedOn ?? '', ownershipNote: asset.ownershipNote ?? '' };
}

function ProofForm({ asset, onSaved }: { asset: AssetSummary; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [proofDraft, setProofDraft] = useState<OwnershipProofInput>(() => toProofInput(asset));
  const saveMutation = useMutation({
    mutationFn: () => sendJson<AssetSummary>(`/assets/${asset.assetId}/ownership-proof`, 'PUT', proofDraft),
    onSuccess: async (savedAsset) => {
      queryClient.setQueryData(assetQueryKey(asset.assetId), savedAsset);
      await queryClient.invalidateQueries({ queryKey: ['assets'] });
      onSaved();
    },
  });
  const updateField = (fieldName: keyof OwnershipProofInput) => (changeEvent: { target: { value: string } }) => setProofDraft({ ...proofDraft, [fieldName]: changeEvent.target.value });
  const submitProof = (formEvent: FormEvent) => { formEvent.preventDefault(); saveMutation.mutate(); };
  return (
    <form className="flex flex-col gap-3" onSubmit={submitProof}>
      <FieldLabel label="First published at" hint="Where you first posted it: your site, portfolio or social post">
        <TextInput type="url" placeholder="https://" value={proofDraft.firstPublishedUrl ?? ''} onChange={updateField('firstPublishedUrl')} />
      </FieldLabel>
      <FieldLabel label="First published on">
        <TextInput type="date" max={new Date().toISOString().slice(0, 10)} value={proofDraft.firstPublishedOn ?? ''} onChange={updateField('firstPublishedOn')} />
      </FieldLabel>
      <FieldLabel label="Note" hint="Optional, for example: RAW file and the rest of the shoot available on request">
        <TextArea rows={2} maxLength={MAX_NOTE_LENGTH} value={proofDraft.ownershipNote ?? ''} onChange={updateField('ownershipNote')} />
      </FieldLabel>
      {saveMutation.error && <Message tone="danger">{saveMutation.error.message}</Message>}
      <div><Button variant="primary" type="submit" disabled={saveMutation.isPending}>Save proof</Button></div>
    </form>
  );
}

// On the Originals page: add or edit the proof for one original
export function OwnershipProofDialog({ asset, onClose }: { asset: AssetSummary; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const creatorProfile = useCreatorProfile();
  useEffect(() => { if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal(); }, []);
  return (
    <dialog ref={dialogRef} onClose={onClose} aria-labelledby="proof-title"
      className="m-auto max-h-[calc(100vh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/50">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="proof-title" className="text-lg font-semibold">Proof of ownership · original #{asset.assetId}</h2>
            <p className="text-sm text-ink-muted">Shown when you review a match, and added to the evidence pack and notice. Repost Radar doesn't verify it; it's your own statement.</p>
          </div>
          <Button variant="ghost" onClick={() => dialogRef.current?.close()} aria-label="Close">✕</Button>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <img src={assetImageUrl(asset.assetId)} alt={`Original #${asset.assetId}`} className="h-20 w-20 shrink-0 rounded border border-line bg-surface-muted object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">From the file</p>
            <FileMetadataRows asset={asset} legalName={creatorProfile?.legalName ?? null} />
          </div>
        </div>
        <ProofForm asset={asset} onSaved={() => dialogRef.current?.close()} />
      </div>
    </dialog>
  );
}
