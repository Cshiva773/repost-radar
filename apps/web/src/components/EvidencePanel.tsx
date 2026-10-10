import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ApiError, apiRequest, candidatePackUrl, sendJson, type NoticeDetails } from '../lib/api';
import { formatTimestamp } from '../lib/format';
import { Button, Card, Message, TextArea } from './ui';

const GENERATING_POLL_MS = 2000;

type NoticeState = { kind: 'ready'; notice: NoticeDetails } | { kind: 'generating' } | { kind: 'failed'; message: string };

// GET /notice: 200 with the notice once the pack exists, 202 while the worker builds it, 409 with what to fix
async function fetchNoticeState(candidateId: number): Promise<NoticeState> {
  try {
    const noticeBody = await apiRequest<NoticeDetails | { message: string }>(`/candidates/${candidateId}/notice`);
    return 'noticeText' in noticeBody ? { kind: 'ready', notice: noticeBody } : { kind: 'generating' };
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 409) return { kind: 'failed', message: error.message };
    throw error;
  }
}

function downloadText(fileName: string, fileText: string): void {
  const objectUrl = URL.createObjectURL(new Blob([fileText], { type: 'text/plain;charset=utf-8' }));
  const anchorElement = Object.assign(document.createElement('a'), { href: objectUrl, download: fileName });
  anchorElement.click();
  URL.revokeObjectURL(objectUrl);
}

function NoticeEditor({ candidateId, notice }: { candidateId: number; notice: NoticeDetails }) {
  const queryClient = useQueryClient();
  const [draftText, setDraftText] = useState(notice.noticeText);
  const [copyLabel, setCopyLabel] = useState('Copy');
  useEffect(() => setDraftText(notice.noticeText), [notice.noticeText]);
  const saveMutation = useMutation({
    mutationFn: () => sendJson<{ noticeText: string }>(`/candidates/${candidateId}/notice`, 'PUT', { noticeText: draftText }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notice', candidateId] }),
  });
  const copyNotice = async () => {
    await navigator.clipboard.writeText(draftText);
    setCopyLabel('Copied');
    setTimeout(() => setCopyLabel('Copy'), 1500);
  };
  return (
    <div className="flex flex-col gap-2">
      <TextArea rows={14} value={draftText} onChange={(changeEvent) => setDraftText(changeEvent.target.value)} className="font-mono text-xs" aria-label="Notice text" />
      {saveMutation.error && <Message tone="danger">{saveMutation.error.message}</Message>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={draftText === notice.noticeText || saveMutation.isPending} onClick={() => saveMutation.mutate()}>Save edits</Button>
        <Button onClick={() => void copyNotice()}>{copyLabel}</Button>
        <Button onClick={() => downloadText(`notice-candidate-${candidateId}.txt`, draftText)}>Download .txt</Button>
      </div>
    </div>
  );
}

export function EvidencePanel({ candidateId }: { candidateId: number }) {
  const queryClient = useQueryClient();
  const noticeQuery = useQuery({
    queryKey: ['notice', candidateId],
    queryFn: () => fetchNoticeState(candidateId),
    refetchInterval: (query) => (query.state.data?.kind === 'generating' ? GENERATING_POLL_MS : false),
    // Keep polling in a background tab: the pack is ready when the reviewer comes back
    refetchIntervalInBackground: true,
  });
  const rebuildMutation = useMutation({
    mutationFn: () => apiRequest(`/candidates/${candidateId}/pack`, { method: 'POST' }),
    onSuccess: () => queryClient.setQueryData(['notice', candidateId], { kind: 'generating' }),
  });
  const confirmRebuild = () => {
    if (noticeQuery.data?.kind !== 'ready' || window.confirm('Rebuild the pack? Your edits to the notice will be replaced.')) rebuildMutation.mutate();
  };
  const noticeState = noticeQuery.data;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Evidence pack and notice</h2>
        <div className="flex gap-2">
          {noticeState?.kind === 'ready' && <a href={candidatePackUrl(candidateId)} download className="inline-flex items-center rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:opacity-90">Download ZIP</a>}
          {noticeState && noticeState.kind !== 'generating' && <Button onClick={confirmRebuild} disabled={rebuildMutation.isPending}>Rebuild</Button>}
        </div>
      </div>
      {noticeQuery.isPending || noticeState?.kind === 'generating' ? <Message>Building the pack: side-by-side image, PDF summary, metadata and notice…</Message> : null}
      {noticeState?.kind === 'failed' && (
        <Message tone="danger">
          {noticeState.message} <Link className="underline" to="/settings">Settings</Link> · <Link className="underline" to="/templates">Templates</Link>
        </Message>
      )}
      {noticeQuery.error && <Message tone="danger">{noticeQuery.error.message}</Message>}
      {noticeState?.kind === 'ready' && (
        <>
          <p className="text-xs text-ink-muted">Generated {formatTimestamp(noticeState.notice.generatedAt)}. Review and edit, then file it with the platform yourself.</p>
          <NoticeEditor candidateId={candidateId} notice={noticeState.notice} />
        </>
      )}
    </Card>
  );
}
