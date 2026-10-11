import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type DragEvent } from 'react';
import { NextStepNudge } from '../components/SetupGuide';
import { Badge, Button, Card, EmptyState, Message } from '../components/ui';
import { ApiError, apiRequest, assetImageUrl, type AssetPage } from '../lib/api';
import { formatCount, formatRelativeTime } from '../lib/format';

const PAGE_SIZE = 48;
const FINGERPRINT_POLL_MS = 2000;
const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp';

interface UploadOutcome {
  fileName: string;
  tone: 'approve' | 'caution' | 'danger';
  message: string;
}

async function uploadOriginal(imageFile: File): Promise<UploadOutcome> {
  const uploadForm = new FormData();
  uploadForm.append('file', imageFile);
  try {
    await apiRequest('/assets', { method: 'POST', body: uploadForm });
    return { fileName: imageFile.name, tone: 'approve', message: 'added, fingerprinting' };
  } catch (error) {
    const isDuplicate = error instanceof ApiError && error.statusCode === 409;
    return { fileName: imageFile.name, tone: isDuplicate ? 'caution' : 'danger', message: isDuplicate ? 'already registered' : (error as Error).message };
  }
}

function UploadZone({ onUploaded }: { onUploaded: (addedCount: number) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [outcomeList, setOutcomeList] = useState<UploadOutcome[]>([]);

  // One at a time: keeps memory flat for large folders and reports each file as it lands
  const uploadFiles = async (imageFileList: File[]) => {
    setIsUploading(true);
    setOutcomeList([]);
    let addedCount = 0;
    for (const imageFile of imageFileList) {
      const uploadOutcome = await uploadOriginal(imageFile);
      if (uploadOutcome.tone === 'approve') addedCount += 1;
      setOutcomeList((previousList) => [...previousList, uploadOutcome]);
    }
    setIsUploading(false);
    onUploaded(addedCount);
  };
  const handleDrop = (dragEvent: DragEvent) => {
    dragEvent.preventDefault();
    setIsDragging(false);
    void uploadFiles([...dragEvent.dataTransfer.files].filter((droppedFile) => ACCEPTED_TYPES.includes(droppedFile.type)));
  };

  return (
    <Card className="p-4">
      <div onDragOver={(dragEvent) => { dragEvent.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}
        className={`flex flex-col items-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center ${isDragging ? 'border-accent bg-surface-muted' : 'border-line'}`}>
        <p className="font-medium">Drop images here</p>
        <p className="text-sm text-ink-muted">JPEG, PNG or WebP up to 20 MB. Each one is fingerprinted within a few seconds.</p>
        <Button variant="primary" disabled={isUploading} onClick={() => fileInputRef.current?.click()}>{isUploading ? 'Uploading…' : 'Choose files'}</Button>
        <input ref={fileInputRef} type="file" accept={ACCEPTED_TYPES} multiple hidden
          onChange={(changeEvent) => { void uploadFiles([...(changeEvent.target.files ?? [])]); changeEvent.target.value = ''; }} />
      </div>
      {outcomeList.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {outcomeList.map((uploadOutcome, outcomeIndex) => (
            <li key={`${uploadOutcome.fileName}-${outcomeIndex}`} className="flex items-center gap-2">
              <Badge tone={uploadOutcome.tone}>{uploadOutcome.tone === 'approve' ? 'OK' : uploadOutcome.tone === 'caution' ? 'Skipped' : 'Failed'}</Badge>
              <span className="truncate">{uploadOutcome.fileName}</span>
              <span className="text-ink-muted">{uploadOutcome.message}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function OriginalsPage() {
  const queryClient = useQueryClient();
  const [pageOffset, setPageOffset] = useState(0);
  const [hasAddedOriginals, setHasAddedOriginals] = useState(false);
  const assetQuery = useQuery({
    queryKey: ['assets', pageOffset],
    queryFn: () => apiRequest<AssetPage>(`/assets?pageSize=${PAGE_SIZE}&pageOffset=${pageOffset}`),
    placeholderData: keepPreviousData,
    // Poll only while something on screen is still being fingerprinted
    refetchInterval: (query) => (query.state.data?.assetList.some((asset) => !asset.isFingerprinted) ? FINGERPRINT_POLL_MS : false),
    refetchIntervalInBackground: true,
  });
  const assetPage = assetQuery.data;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Originals</h1>
        <p className="text-sm text-ink-muted">Your images. Every crawled post is compared against these. The original files stay private; only fingerprints are used for matching.</p>
      </div>
      <UploadZone onUploaded={(addedCount) => { if (addedCount > 0) setHasAddedOriginals(true); void queryClient.invalidateQueries({ queryKey: ['assets'] }); }} />
      {hasAddedOriginals && <NextStepNudge currentStepName="originals" />}
      {assetQuery.error && <Message tone="danger">{assetQuery.error.message}</Message>}
      {assetPage && assetPage.totalCount === 0 && <Card><EmptyState title="No originals yet">Drop the photos you want to protect above, or choose files. Only their fingerprints are used to find copies.</EmptyState></Card>}
      {assetPage && assetPage.assetList.length > 0 && (
        <>
          <p className="text-sm text-ink-muted">{formatCount(assetPage.totalCount, 'original', 'originals')}</p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {assetPage.assetList.map((asset) => (
              <li key={asset.assetId}>
                <Card className="overflow-hidden">
                  <img src={assetImageUrl(asset.assetId)} alt={`Original #${asset.assetId}`} loading="lazy" className="aspect-square w-full bg-surface-muted object-cover" />
                  <div className="flex items-center justify-between gap-1 px-2 py-1.5 text-xs">
                    <span className="text-ink-muted">#{asset.assetId} · {formatRelativeTime(asset.createdAt)}</span>
                    {asset.isFingerprinted ? <Badge tone="approve">Ready</Badge> : <Badge tone="caution">Processing</Badge>}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      {assetPage && assetPage.totalCount > PAGE_SIZE && (
        <div className="flex justify-end gap-2">
          <Button disabled={pageOffset === 0} onClick={() => setPageOffset(Math.max(0, pageOffset - PAGE_SIZE))}>Previous</Button>
          <Button disabled={pageOffset + PAGE_SIZE >= assetPage.totalCount} onClick={() => setPageOffset(pageOffset + PAGE_SIZE)}>Next</Button>
        </div>
      )}
    </div>
  );
}
