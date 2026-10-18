import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest, type OwnAccountDetails, type PlatformDescription } from '../lib/api';
import { formatAuthor, platformDisplayName } from '../lib/format';
import { Button, TextInput } from './ui';

const MAX_OWN_ACCOUNTS = 20;

// Same normalisation as the API (apps/api/src/creator/ownAccounts.ts), so the list shows what is stored
function normaliseHandle(rawHandle: string): string {
  return rawHandle.trim().replace(/^@/, '').replace(/^\/?u\//i, '').toLowerCase();
}

interface OwnAccountsFieldProps {
  ownAccountList: OwnAccountDetails[];
  onChange: (ownAccountList: OwnAccountDetails[]) => void;
}

// Part of the Settings form: saved with the rest of the profile
export function OwnAccountsField({ ownAccountList, onChange }: OwnAccountsFieldProps) {
  const platformQuery = useQuery({ queryKey: ['platforms'], queryFn: () => apiRequest<{ platformList: PlatformDescription[] }>('/platforms'), staleTime: Infinity });
  const platformList = platformQuery.data?.platformList ?? [];
  const [platformName, setPlatformName] = useState('');
  const [handleText, setHandleText] = useState('');
  const selectedPlatform = platformName || platformList[0]?.platformName || 'bluesky';
  const handle = normaliseHandle(handleText);
  const isDuplicate = ownAccountList.some((ownAccount) => ownAccount.platform === selectedPlatform && ownAccount.handle === handle);
  const addAccount = () => {
    if (!handle || isDuplicate) return;
    onChange([...ownAccountList, { platform: selectedPlatform, handle }]);
    setHandleText('');
  };
  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="font-medium">Your own accounts</legend>
      <p className="text-xs text-ink-muted">Matches on posts from these accounts are marked "Your own post" and can't be approved, so you never file a notice against yourself.</p>
      {ownAccountList.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {ownAccountList.map((ownAccount) => (
            <li key={`${ownAccount.platform}:${ownAccount.handle}`} className="flex items-center gap-1 rounded-md border border-line py-0.5 pl-2 pr-0.5">
              <span>{formatAuthor(ownAccount.platform, ownAccount.handle)}</span>
              <span className="text-xs text-ink-muted">{platformDisplayName(ownAccount.platform)}</span>
              <Button variant="ghost" className="px-1.5 py-0.5" aria-label={`Remove ${formatAuthor(ownAccount.platform, ownAccount.handle)}`}
                onClick={() => onChange(ownAccountList.filter((listedAccount) => listedAccount !== ownAccount))}>✕</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <select aria-label="Platform" className="rounded-md border border-line bg-surface px-2 py-2 text-sm" value={selectedPlatform} onChange={(changeEvent) => setPlatformName(changeEvent.target.value)}>
          {platformList.map((platform) => <option key={platform.platformName} value={platform.platformName}>{platform.displayName}</option>)}
        </select>
        <div className="min-w-0 flex-1">
          <TextInput aria-label="Account" placeholder={selectedPlatform === 'reddit' ? 'u/yourname' : '@you.bsky.social'} value={handleText}
            onChange={(changeEvent) => setHandleText(changeEvent.target.value)}
            onKeyDown={(keyEvent) => { if (keyEvent.key === 'Enter') { keyEvent.preventDefault(); addAccount(); } }} />
        </div>
        <Button onClick={addAccount} disabled={!handle || isDuplicate || ownAccountList.length >= MAX_OWN_ACCOUNTS}>Add</Button>
      </div>
      {ownAccountList.length > 0 && <p className="text-xs text-ink-muted">Save to apply changes.</p>}
    </fieldset>
  );
}
