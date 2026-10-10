import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { ApiError } from './lib/api';
import './index.css';

const SESSION_QUERY_KEY_NAME = 'session';

// A 401 from any other request means the session expired: re-check it, and App falls back to the sign-in
// page. The session query's own 401 is skipped, or re-checking would loop forever.
function handleSessionExpiry(error: Error): void {
  if (error instanceof ApiError && error.statusCode === 401) void queryClient.invalidateQueries({ queryKey: [SESSION_QUERY_KEY_NAME] });
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error, query) => { if (query.queryKey[0] !== SESSION_QUERY_KEY_NAME) handleSessionExpiry(error); } }),
  mutationCache: new MutationCache({ onError: handleSessionExpiry }),
  defaultOptions: {
    queries: {
      // A 401 means the session ended; App sends the reviewer to sign in rather than retrying
      retry: (failureCount, error) => !(error instanceof ApiError && error.statusCode < 500) && failureCount < 2,
      refetchOnWindowFocus: false,
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('index.html is missing #root');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
