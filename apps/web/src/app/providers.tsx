'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  // One client per browser session (useState keeps it across re-renders).
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            // Retrying a 4xx (401, 403, 404, 422) cannot succeed; retry only server hiccups.
            retry: (failures, error) =>
              !(error instanceof ApiError && error.status < 500) && failures < 2,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
