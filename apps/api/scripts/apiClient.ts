// Shared by host-side scripts (seed, phase 4 check): reads the repo's .env, signs in as the admin and
// reuses the session cookie on every request.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LOGIN_ATTEMPTS = 15;
const LOGIN_RETRY_MS = 2000;

export interface ApiClientInstance {
  request(requestPath: string, requestInit?: RequestInit): Promise<Response>;
}

export function loadRepoEnv(): void {
  const envPath = join(REPO_ROOT, '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

function readSessionCookie(loginResponse: Response): string {
  const sessionCookie = loginResponse.headers.getSetCookie().find((cookieHeader) => cookieHeader.startsWith('rr_session='));
  if (!sessionCookie) throw new Error('Sign-in succeeded but no session cookie came back');
  return sessionCookie.split(';')[0] ?? '';
}

async function signIn(apiUrl: string): Promise<string> {
  const loginBody = JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD ?? '' });
  for (let attempt = 1; attempt <= LOGIN_ATTEMPTS; attempt++) {
    const loginResponse = await fetch(`${apiUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: loginBody });
    if (loginResponse.ok) return readSessionCookie(loginResponse);
    // 503: the API is still creating the admin account (migrations just ran); anything else is final
    if (loginResponse.status !== 503) throw new Error(`Sign-in failed: HTTP ${loginResponse.status} ${await loginResponse.text()}`);
    await new Promise((resolve) => setTimeout(resolve, LOGIN_RETRY_MS));
  }
  throw new Error(`Sign-in still unavailable after ${LOGIN_ATTEMPTS} attempts`);
}

export async function createApiClient(apiUrl: string): Promise<ApiClientInstance> {
  if (!process.env.ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD is not set (copy .env.example to .env)');
  const sessionCookie = await signIn(apiUrl);
  return {
    request: (requestPath, requestInit = {}) => fetch(`${apiUrl}${requestPath}`, {
      ...requestInit, headers: { ...(requestInit.headers as Record<string, string> | undefined), cookie: sessionCookie },
    }),
  };
}
