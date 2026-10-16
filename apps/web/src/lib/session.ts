'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch, type Role, type SessionUser } from './api';

export function useSession() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<{ user: SessionUser }>('/api/auth/me').then((r) => r.user),
    staleTime: 60_000,
  });
}

// Landing page per role. Navigation by role is a convenience: the API enforces access.
export function homeFor(role: Role): string {
  return role === 'ADMIN' ? '/dashboard' : '/leads';
}
