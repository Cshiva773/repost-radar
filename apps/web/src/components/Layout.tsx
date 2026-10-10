import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { apiRequest } from '../lib/api';
import { Button } from './ui';

const NAV_LINK_LIST = [
  { to: '/queue/pending', label: 'Review', matchPrefix: '/queue' },
  { to: '/templates', label: 'Templates', matchPrefix: '/templates' },
  { to: '/settings', label: 'Settings', matchPrefix: '/settings' },
];

export function Layout({ username, children }: { username: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const signOut = async () => {
    await apiRequest('/auth/logout', { method: 'POST' }).catch(() => undefined);
    queryClient.clear();
    navigate('/login');
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="flex items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="h-5 w-5" />
            Repost Radar
          </span>
          <nav className="flex gap-1 text-sm" aria-label="Main">
            {NAV_LINK_LIST.map((navLink) => (
              <NavLink
                key={navLink.to}
                to={navLink.to}
                className={({ isActive }) => `rounded-md px-3 py-1.5 ${isActive || pathname.startsWith(navLink.matchPrefix) ? 'bg-surface-muted font-medium text-ink' : 'text-ink-muted hover:text-ink'}`}
              >
                {navLink.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm text-ink-muted">
            <span>{username}</span>
            <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
