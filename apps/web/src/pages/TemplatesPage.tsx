import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Button, Card, FieldLabel, Message, TextArea, TextInput } from '../components/ui';
import { apiRequest, sendJson, type NoticeTemplate, type PlaceholderDescription, type PlatformDescription } from '../lib/api';
import { formatTimestamp, platformDisplayName } from '../lib/format';

interface TemplateListResponse {
  noticeTemplateList: NoticeTemplate[];
  placeholderList: PlaceholderDescription[];
}

type TemplateDraft = Pick<NoticeTemplate, 'platform' | 'name' | 'subject' | 'body'> & { templateId?: number };

const EMPTY_DRAFT: TemplateDraft = { platform: 'reddit', name: '', subject: 'Copyright infringement notice: {{infringing_url}}', body: '' };

function TemplateEditor({ draft, platformNameList, placeholderList, onDone }: {
  draft: TemplateDraft; platformNameList: string[]; placeholderList: PlaceholderDescription[]; onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [editedDraft, setEditedDraft] = useState(draft);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const saveMutation = useMutation({
    mutationFn: () => (editedDraft.templateId
      ? sendJson<NoticeTemplate>(`/notice-templates/${editedDraft.templateId}`, 'PUT', editedDraft)
      : sendJson<NoticeTemplate>('/notice-templates', 'POST', editedDraft)),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['notice-templates'] }); onDone(); },
  });
  const insertPlaceholder = (placeholderName: string) => {
    const bodyElement = bodyRef.current;
    const insertAt = bodyElement?.selectionStart ?? editedDraft.body.length;
    const placeholderText = `{{${placeholderName}}}`;
    setEditedDraft({ ...editedDraft, body: editedDraft.body.slice(0, insertAt) + placeholderText + editedDraft.body.slice(insertAt) });
    requestAnimationFrame(() => { bodyElement?.focus(); bodyElement?.setSelectionRange(insertAt + placeholderText.length, insertAt + placeholderText.length); });
  };

  return (
    <Card className="grid gap-4 p-4 lg:grid-cols-[1fr_16rem]">
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <FieldLabel label="Platform">
            <select className="rounded-md border border-line bg-surface px-2 py-2 text-sm" value={editedDraft.platform} onChange={(changeEvent) => setEditedDraft({ ...editedDraft, platform: changeEvent.target.value })}>
              {platformNameList.map((platformName) => <option key={platformName} value={platformName}>{platformDisplayName(platformName)}</option>)}
            </select>
          </FieldLabel>
          <FieldLabel label="Name"><TextInput value={editedDraft.name} onChange={(changeEvent) => setEditedDraft({ ...editedDraft, name: changeEvent.target.value })} /></FieldLabel>
        </div>
        <FieldLabel label="Subject"><TextInput value={editedDraft.subject} onChange={(changeEvent) => setEditedDraft({ ...editedDraft, subject: changeEvent.target.value })} /></FieldLabel>
        <FieldLabel label="Body" hint="Every placeholder must have a value when a pack is built, or the build stops and tells you which one is missing.">
          <TextArea ref={bodyRef} rows={18} className="font-mono text-xs" value={editedDraft.body} onChange={(changeEvent) => setEditedDraft({ ...editedDraft, body: changeEvent.target.value })} />
        </FieldLabel>
        {saveMutation.error && <Message tone="danger">{saveMutation.error.message}</Message>}
        <div className="flex gap-2">
          <Button variant="primary" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>Save template</Button>
          <Button onClick={onDone}>Cancel</Button>
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Placeholders</p>
        <ul className="flex flex-col gap-1">
          {placeholderList.map((placeholder) => (
            <li key={placeholder.name}>
              <button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-surface-muted" onClick={() => insertPlaceholder(placeholder.name)}>
                <code className="text-xs text-accent">{`{{${placeholder.name}}}`}</code>
                <span className="block text-xs text-ink-muted">{placeholder.description}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export function TemplatesPage() {
  const queryClient = useQueryClient();
  const [activeDraft, setActiveDraft] = useState<TemplateDraft | undefined>();
  const templateQuery = useQuery({ queryKey: ['notice-templates'], queryFn: () => apiRequest<TemplateListResponse>('/notice-templates') });
  const platformQuery = useQuery({ queryKey: ['platforms'], queryFn: () => apiRequest<{ platformList: PlatformDescription[] }>('/platforms'), staleTime: Infinity });
  const deleteMutation = useMutation({
    mutationFn: (templateId: number) => apiRequest(`/notice-templates/${templateId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notice-templates'] }),
  });
  const templateList = templateQuery.data?.noticeTemplateList ?? [];
  const platformNameList = [...new Set(['reddit', 'bluesky', ...(platformQuery.data?.platformList.map((platform) => platform.platformName) ?? [])])];

  if (activeDraft && templateQuery.data) {
    return <TemplateEditor key={activeDraft.templateId ?? 'new'} draft={activeDraft} platformNameList={platformNameList} placeholderList={templateQuery.data.placeholderList} onDone={() => setActiveDraft(undefined)} />;
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Notice templates</h1>
          <p className="text-sm text-ink-muted">A pack uses the most recently updated template for the platform the copy was found on.</p>
        </div>
        <Button variant="primary" onClick={() => setActiveDraft(EMPTY_DRAFT)}>New template</Button>
      </div>
      {templateQuery.error && <Message tone="danger">{templateQuery.error.message}</Message>}
      {deleteMutation.error && <Message tone="danger">{deleteMutation.error.message}</Message>}
      <Card>
        <ul className="divide-y divide-line">
          {templateList.map((template) => (
            <li key={template.templateId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{template.name}</p>
                <p className="text-xs text-ink-muted">{platformDisplayName(template.platform)} · updated {formatTimestamp(template.updatedAt)}</p>
              </div>
              <Button onClick={() => setActiveDraft(template)}>Edit</Button>
              <Button variant="danger" onClick={() => window.confirm(`Delete "${template.name}"?`) && deleteMutation.mutate(template.templateId)}>Delete</Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
