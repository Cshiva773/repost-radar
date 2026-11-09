import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { SESSION_QUERY_KEY } from '../App';
import { Button, Card, FieldLabel, Message, TextInput } from '../components/ui';
import { ApiError, apiRequest, sendJson } from '../lib/api';
import { resolveReturnPath } from '../lib/returnPath';

export const AUTH_OPTIONS_QUERY_KEY = ['auth-options'];

// Whether this server lets people create their own account (SIGNUP_ENABLED)
export function useSignupEnabled(): boolean {
  const optionsQuery = useQuery({
    queryKey: AUTH_OPTIONS_QUERY_KEY, queryFn: () => apiRequest<{ isSignupEnabled: boolean }>('/auth/options'), staleTime: Infinity, retry: false,
  });
  return optionsQuery.data?.isSignupEnabled ?? false;
}

// Shared frame of the sign-in and sign-up pages
export function AuthCard({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="flex w-full max-w-sm flex-col gap-3">
        <Card className="p-6">{children}</Card>
        {footer && <p className="text-center text-sm text-ink-muted">{footer}</p>}
      </div>
    </div>
  );
}

export function AuthHeading({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2">
      <img src="/favicon.svg" alt="" className="h-6 w-6" />
      <h1 className="text-lg font-semibold">Repost Radar · {title}</h1>
    </div>
  );
}

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const locationState = useLocation().state;
  const isSignupEnabled = useSignupEnabled();

  const submitLogin = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(undefined);
    try {
      const sessionDetails = await sendJson<{ username: string }>('/auth/login', 'POST', { username, password });
      queryClient.setQueryData(SESSION_QUERY_KEY, sessionDetails);
      navigate(resolveReturnPath(locationState), { replace: true });
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Could not reach the API');
    } finally {
      setIsSubmitting(false);
    }
  };

  const signupFooter = isSignupEnabled ? <>New here? <Link className="font-medium text-accent hover:underline" to="/signup" state={locationState}>Create an account</Link></> : undefined;
  return (
    <AuthCard footer={signupFooter}>
      <form className="flex flex-col gap-4" onSubmit={(formEvent) => void submitLogin(formEvent)}>
        <AuthHeading title="Sign in" />
        <FieldLabel label="Email" hint="The operator signs in with ADMIN_USERNAME from .env instead">
          <TextInput autoComplete="username" placeholder="you@example.com" value={username} onChange={(changeEvent) => setUsername(changeEvent.target.value)} required autoFocus />
        </FieldLabel>
        <FieldLabel label="Password">
          <TextInput type="password" autoComplete="current-password" value={password} onChange={(changeEvent) => setPassword(changeEvent.target.value)} required />
        </FieldLabel>
        {errorMessage && <Message tone="danger">{errorMessage}</Message>}
        <Button variant="primary" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
      </form>
    </AuthCard>
  );
}
