import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { SESSION_QUERY_KEY } from '../App';
import { Button, FieldLabel, Message, TextInput } from '../components/ui';
import { ApiError, sendJson } from '../lib/api';
import { DEFAULT_SIGNED_IN_PATH } from '../lib/returnPath';
import { AuthCard, AuthHeading, useSignupEnabled } from './LoginPage';

const MIN_PASSWORD_LENGTH = 12;

interface SignupDraft {
  displayName: string;
  email: string;
  password: string;
}

// A new creator: their own private space, signed in straight away and sent to the setup checklist
export function SignupPage() {
  const [signupDraft, setSignupDraft] = useState<SignupDraft>({ displayName: '', email: '', password: '' });
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isSignupEnabled = useSignupEnabled();
  const updateField = (fieldName: keyof SignupDraft) => (changeEvent: { target: { value: string } }) => setSignupDraft({ ...signupDraft, [fieldName]: changeEvent.target.value });

  const submitSignup = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(undefined);
    try {
      const sessionDetails = await sendJson<{ username: string }>('/auth/signup', 'POST', signupDraft);
      queryClient.setQueryData(SESSION_QUERY_KEY, sessionDetails);
      navigate(DEFAULT_SIGNED_IN_PATH, { replace: true });
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Could not reach the API');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthCard footer={<>Already have an account? <Link className="font-medium text-accent hover:underline" to="/login">Sign in</Link></>}>
      <form className="flex flex-col gap-4" onSubmit={(formEvent) => void submitSignup(formEvent)}>
        <AuthHeading title="Create an account" />
        <p className="text-sm text-ink-muted">Your own private space: your originals, sources and matches are only visible to you.</p>
        {!isSignupEnabled && <Message tone="caution">Sign-up is turned off on this server. Ask whoever runs it for an account.</Message>}
        <FieldLabel label="Your name" hint="Shown in the app; you can change it in Settings">
          <TextInput autoComplete="name" value={signupDraft.displayName} onChange={updateField('displayName')} autoFocus />
        </FieldLabel>
        <FieldLabel label="Email" hint="You sign in with this">
          <TextInput type="email" autoComplete="email" placeholder="you@example.com" value={signupDraft.email} onChange={updateField('email')} required />
        </FieldLabel>
        <FieldLabel label="Password" hint={`At least ${MIN_PASSWORD_LENGTH} characters`}>
          <TextInput type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} value={signupDraft.password} onChange={updateField('password')} required />
        </FieldLabel>
        {errorMessage && <Message tone="danger">{errorMessage}</Message>}
        <Button variant="primary" type="submit" disabled={isSubmitting || !isSignupEnabled}>{isSubmitting ? 'Creating your space…' : 'Create account'}</Button>
      </form>
    </AuthCard>
  );
}
