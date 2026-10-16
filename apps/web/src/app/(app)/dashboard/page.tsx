'use client';

import { Suspense } from 'react';
import { LeadsTable } from '@/components/leads-table';
import { MetricsStrip, useMetrics } from '@/components/metrics-strip';
import { PageHeader } from '@/components/page-header';

export default function DashboardPage() {
  const { dataUpdatedAt } = useMetrics();

  return (
    <>
      <PageHeader
        kicker="Painel"
        title="Todos os leads"
        aside={
          dataUpdatedAt > 0 && (
            <p className="text-xs text-muted" aria-live="polite">
              Atualizado às{' '}
              <span className="num">
                {new Date(dataUpdatedAt).toLocaleTimeString('pt-BR', {
                  timeZone: 'America/Sao_Paulo',
                })}
              </span>
            </p>
          )
        }
      />
      <MetricsStrip />
      {/* useSearchParams needs a Suspense boundary in the App Router. */}
      <Suspense>
        <LeadsTable showCallCenter />
      </Suspense>
    </>
  );
}
