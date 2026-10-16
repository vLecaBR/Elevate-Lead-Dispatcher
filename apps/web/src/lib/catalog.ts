'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch, type Catalog } from './api';

// Filter options, already limited to the user's scope by the API.
export function useCatalog() {
  return useQuery({
    queryKey: ['catalog'],
    queryFn: () => apiFetch<Catalog>('/api/catalog'),
    staleTime: 5 * 60_000,
  });
}
