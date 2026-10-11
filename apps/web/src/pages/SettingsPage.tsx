import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiTokenSection } from '../components/ApiTokenSection';
import { Button, Card, FieldLabel, Message, TextArea, TextInput } from '../components/ui';
import { apiRequest, sendJson, type CreatorProfile } from '../lib/api';

type ProfileDraft = Pick<CreatorProfile, 'name' | 'legalName' | 'contactEmail' | 'mailingAddress' | 'timeZone'>;

const BROWSER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TIME_ZONE_LIST: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [BROWSER_TIME_ZONE];

// A profile still on the default UTC most likely never chose a zone: suggest this browser's
function suggestTimeZone(storedTimeZone: string): string {
  return storedTimeZone === 'UTC' ? BROWSER_TIME_ZONE : storedTimeZone;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({ queryKey: ['creator'], queryFn: () => apiRequest<CreatorProfile>('/creator') });
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>({ name: '', legalName: '', contactEmail: '', mailingAddress: '', timeZone: BROWSER_TIME_ZONE });
  useEffect(() => { if (profileQuery.data) setProfileDraft({ ...profileQuery.data, timeZone: suggestTimeZone(profileQuery.data.timeZone) }); }, [profileQuery.data]);
  const saveMutation = useMutation({
    mutationFn: () => sendJson<CreatorProfile>('/creator', 'PUT', profileDraft),
    onSuccess: (savedProfile) => queryClient.setQueryData(['creator'], savedProfile),
  });
  const submitProfile = (formEvent: FormEvent) => { formEvent.preventDefault(); saveMutation.mutate(); };
  const updateField = (fieldName: keyof ProfileDraft) => (changeEvent: { target: { value: string } }) => setProfileDraft({ ...profileDraft, [fieldName]: changeEvent.target.value });

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-ink-muted">A takedown notice must include who is sending it and how to reach them (17 U.S.C. §512(c)(3)). These details fill the notice's placeholders.</p>
      </div>
      {profileQuery.data && !profileQuery.data.isNoticeReady && <Message tone="caution">Fill in your legal name, email and address before approving a match.</Message>}
      <Card className="p-4">
        <form className="flex flex-col gap-3" onSubmit={submitProfile}>
          <FieldLabel label="Display name"><TextInput value={profileDraft.name} onChange={updateField('name')} required /></FieldLabel>
          <FieldLabel label="Legal name" hint="Used as your signature on notices"><TextInput value={profileDraft.legalName ?? ''} onChange={updateField('legalName')} /></FieldLabel>
          <FieldLabel label="Contact email"><TextInput type="email" value={profileDraft.contactEmail ?? ''} onChange={updateField('contactEmail')} /></FieldLabel>
          <FieldLabel label="Mailing address"><TextArea rows={3} value={profileDraft.mailingAddress ?? ''} onChange={updateField('mailingAddress')} /></FieldLabel>
          <FieldLabel label="Time zone" hint={profileQuery.data && profileQuery.data.timeZone !== profileDraft.timeZone ? `Suggested from this browser; Save to use it (currently ${profileQuery.data.timeZone}).` : 'Dates and times on notices use this zone.'}>
            <select className="rounded-md border border-line bg-surface px-2 py-2 text-sm" value={profileDraft.timeZone} onChange={updateField('timeZone')}>
              {[...new Set([profileDraft.timeZone, ...TIME_ZONE_LIST])].map((timeZone) => <option key={timeZone} value={timeZone}>{timeZone.replaceAll('_', ' ')}</option>)}
            </select>
          </FieldLabel>
          {saveMutation.error && <Message tone="danger">{saveMutation.error.message}</Message>}
          {saveMutation.isSuccess && <Message tone="approve">Saved.</Message>}
          <div><Button variant="primary" type="submit" disabled={saveMutation.isPending}>Save</Button></div>
        </form>
      </Card>
      <ApiTokenSection />
    </div>
  );
}
