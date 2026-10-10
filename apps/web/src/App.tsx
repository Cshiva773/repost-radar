import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { Layout } from './components/Layout';
import { apiRequest, ApiError } from './lib/api';
import { CandidatePage } from './pages/CandidatePage';
import { LoginPage } from './pages/LoginPage';
import { QueuePage } from './pages/QueuePage';
import { SettingsPage } from './pages/SettingsPage';
import { TemplatesPage } from './pages/TemplatesPage';

export const SESSION_QUERY_KEY = ['session'];

function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => apiRequest<{ username: string }>('/auth/me'),
    retry: false,
    staleTime: Infinity,
  });
}

// Keyed by the route param so moving to another candidate or queue starts with fresh state (note, errors, page)
function CandidateRoute() {
  return <CandidatePage key={useParams().candidateId} />;
}

function QueueRoute() {
  return <QueuePage key={useParams().queueName} />;
}

export function App() {
  const sessionQuery = useSession();
  const location = useLocation();
  if (sessionQuery.isPending) return <div className="p-8 text-sm text-ink-muted">Loading…</div>;
  const isSignedOut = sessionQuery.error instanceof ApiError && sessionQuery.error.statusCode === 401;
  if (isSignedOut || !sessionQuery.data) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ returnTo: location.pathname }} />} />
      </Routes>
    );
  }
  return (
    <Layout username={sessionQuery.data.username}>
      <Routes>
        <Route path="/" element={<Navigate to="/queue/pending" replace />} />
        <Route path="/login" element={<Navigate to="/queue/pending" replace />} />
        <Route path="/queue/:queueName" element={<QueueRoute />} />
        <Route path="/candidates/:candidateId" element={<CandidateRoute />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/queue/pending" replace />} />
      </Routes>
    </Layout>
  );
}
