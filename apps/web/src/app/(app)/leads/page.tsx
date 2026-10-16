'use client';

import { Suspense } from 'react';
import { LeadsTable } from '@/components/leads-table';
import { PageHeader } from '@/components/page-header';
import { useCatalog } from '@/lib/catalog';

// OPERATOR home: the API already limits every list and option to their call center.
export default function LeadsPage() {
  const { data: catalog } = useCatalog();
  const callCenter = catalog?.call_centers[0]?.name;

  return (
    <>
      <PageHeader kicker="Leads" title={callCenter ?? 'Seu call center'} />
      <Suspense>
        <LeadsTable showCallCenter={false} />
      </Suspense>
    </>
  );
}
