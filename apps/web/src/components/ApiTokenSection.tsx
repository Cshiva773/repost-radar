import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { apiRequest, sendJson, type ApiTokenSummary } from '../lib/api';
import { formatRelativeTime } from '../lib/format';
import { ConfirmButton } from './ConfirmButton';
import { Button, Card, Message, TextInput } from './ui';

const TOKEN_QUERY_KEY = ['api-tokens'];

// The full token is in the create response only; it is never shown again
function NewTokenNotice({ apiToken, onDismiss }: { apiToken: string; onDismiss: () => void }) {
  const [copyLabel, setCopyLabel] = useState('Copy');
  const copyToken = async () => { await navigator.clipboard.writeText(apiToken); setCopyLabel('Copied'); };
  return (
    <Message tone="approve">
      <p className="mb-2">Copy this token into the extension's options now. It will not be shown again.</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="break-all rounded bg-surface px-2 py-1 text-xs text-ink">{apiToken}</code>
        <Button onClick={() => void copyToken()}>{copyLabel}</Button>
        <Button variant="ghost" onClick={onDismiss}>Done</Button>
      </div>
    </Message>
  );
}

export function ApiTokenSection() {
  const queryClient = useQueryClient();
  const [tokenName, setTokenName] = useState('Chrome extension');
  const [newApiToken, setNewApiToken] = useState<string | undefined>();
  const tokenQuery = useQuery({ queryKey: TOKEN_QUERY_KEY, queryFn: () => apiRequest<{ apiTokenList: ApiTokenSummary[] }>('/api-tokens') });
  const createMutation = useMutation({
    mutationFn: () => sendJson<ApiTokenSummary & { apiToken: string }>('/api-tokens', 'POST', { name: tokenName }),
    onSuccess: async (createdToken) => { setNewApiToken(createdToken.apiToken); await queryClient.invalidateQueries({ queryKey: TOKEN_QUERY_KEY }); },
  });
  const revokeMutation = useMutation({
    mutationFn: (tokenId: number) => apiRequest(`/api-tokens/${tokenId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TOKEN_QUERY_KEY }),
  });
  const submitToken = (formEvent: FormEvent) => { formEvent.preventDefault(); createMutation.mutate(); };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="font-semibold">Browser extension tokens</h2>
        <p className="text-sm text-ink-muted">A token lets the extension check images and read matches. It cannot approve, edit or create more tokens.</p>
      </div>
      {newApiToken && <NewTokenNotice apiToken={newApiToken} onDismiss={() => setNewApiToken(undefined)} />}
      <form className="flex flex-wrap gap-2" onSubmit={submitToken}>
        <div className="min-w-48 flex-1"><TextInput aria-label="Token name" value={tokenName} maxLength={80} onChange={(changeEvent) => setTokenName(changeEvent.target.value)} required /></div>
        <Button type="submit" disabled={createMutation.isPending}>Create token</Button>
      </form>
      {(createMutation.error ?? revokeMutation.error) && <Message tone="danger">{(createMutation.error ?? revokeMutation.error)?.message}</Message>}
      {tokenQuery.data && tokenQuery.data.apiTokenList.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {tokenQuery.data.apiTokenList.map((apiTokenSummary) => (
            <li key={apiTokenSummary.tokenId} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{apiTokenSummary.name} <code className="text-xs text-ink-muted">{apiTokenSummary.tokenPrefix}…</code></p>
                <p className="text-xs text-ink-muted">created {formatRelativeTime(apiTokenSummary.createdAt)} · {apiTokenSummary.lastUsedAt ? `last used ${formatRelativeTime(apiTokenSummary.lastUsedAt)}` : 'never used'}</p>
              </div>
              <ConfirmButton label="Revoke" question="The extension using it stops working." confirmLabel="Yes, revoke" onConfirm={() => revokeMutation.mutate(apiTokenSummary.tokenId)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
