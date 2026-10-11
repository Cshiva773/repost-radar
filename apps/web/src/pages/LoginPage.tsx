import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { SESSION_QUERY_KEY } from '../App';
import { Button, Card, FieldLabel, Message, TextInput } from '../components/ui';
import { ApiError, sendJson } from '../lib/api';
import { resolveReturnPath } from '../lib/returnPath';

export function LoginPage() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const returnPath = resolveReturnPath(useLocation().state);

  const submitLogin = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(undefined);
    try {
      const sessionDetails = await sendJson<{ username: string }>('/auth/login', 'POST', { username, password });
      queryClient.setQueryData(SESSION_QUERY_KEY, sessionDetails);
      navigate(returnPath, { replace: true });
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Could not reach the API');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6">
        <form className="flex flex-col gap-4" onSubmit={(formEvent) => void submitLogin(formEvent)}>
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            <h1 className="text-lg font-semibold">Repost Radar</h1>
          </div>
          <FieldLabel label="Username">
            <TextInput autoComplete="username" value={username} onChange={(changeEvent) => setUsername(changeEvent.target.value)} required />
          </FieldLabel>
          <FieldLabel label="Password" hint="ADMIN_PASSWORD from your .env">
            <TextInput type="password" autoComplete="current-password" value={password} onChange={(changeEvent) => setPassword(changeEvent.target.value)} required autoFocus />
          </FieldLabel>
          {errorMessage && <Message tone="danger">{errorMessage}</Message>}
          <Button variant="primary" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
        </form>
      </Card>
    </div>
  );
}
