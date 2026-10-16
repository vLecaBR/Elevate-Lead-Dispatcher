'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { apiFetch, type LeadPage } from '@/lib/api';
import {
  type FilterKey,
  filtersFromSearch,
  leadsApiPath,
  searchFromFilters,
  withFilter,
} from '@/lib/filters';
import { formatDateTime, formatPhone, formatRelative } from '@/lib/format';
import { LeadDialog } from './lead-dialog';
import { LeadFilters } from './lead-filters';
import { StatusMark } from './status-mark';

export function LeadsTable({ showCallCenter }: { showCallCenter: boolean }) {
  const params = useSearchParams();
  const filters = filtersFromSearch(params);
  const filterKey = searchFromFilters(filters).toString();
  const router = useRouter();
  const pathname = usePathname();

  // Filters live in the URL; the open lead (?lead=) is kept when filters change.
  function navigate(nextFilters: typeof filters) {
    const search = searchFromFilters(nextFilters);
    const lead = params.get('lead');
    if (lead) {
      search.set('lead', lead);
    }
    const query = search.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <section aria-labelledby="leads-title" className="mt-8">
      <h2 id="leads-title" className="label">
        Leads
      </h2>
      <LeadFilters
        filters={filters}
        showCallCenter={showCallCenter}
        onChange={(key: FilterKey, value: string) => navigate(withFilter(filters, key, value))}
        onClear={() => navigate({})}
      />
      {/* New filters = new pagination: keying by the filters resets the cursor stack. */}
      <LeadRows key={filterKey} filterKey={filterKey} showCallCenter={showCallCenter} />
      <LeadDialog />
    </section>
  );
}

function LeadRows({ filterKey, showCallCenter }: { filterKey: string; showCallCenter: boolean }) {
  // Cursors of the pages already visited: "Previous" pops, "Next" pushes. No total count.
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const filters = filtersFromSearch(new URLSearchParams(filterKey));
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const { data, isPending, isError, isPlaceholderData } = useQuery({
    queryKey: ['leads', filterKey, cursor ?? null],
    queryFn: () => apiFetch<LeadPage>(leadsApiPath(filters, cursor)),
    placeholderData: keepPreviousData,
  });

  function openLead(id: string) {
    const search = new URLSearchParams(params);
    search.set('lead', id);
    router.push(`${pathname}?${search.toString()}`, { scroll: false });
  }

  const columns = showCallCenter ? 7 : 6;
  const page = cursors.length + 1;

  return (
    <>
      <div className="overflow-x-auto">
        <table
          aria-busy={isPending || isPlaceholderData}
          className={`w-full min-w-[760px] border-collapse text-left transition-opacity ${
            isPlaceholderData ? 'opacity-60' : ''
          }`}
        >
          <caption className="sr-only">Leads, do mais recente para o mais antigo</caption>
          <thead>
            <tr className="border-b border-rule-strong">
              <Th>Recebido</Th>
              <Th>Nome</Th>
              <Th>Contato</Th>
              <Th>Produto · funil</Th>
              <Th>Origem</Th>
              {showCallCenter && <Th>Call center</Th>}
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {isError && (
              <tr>
                <td colSpan={columns} role="alert" className="py-8 text-danger">
                  Não foi possível carregar os leads.
                </td>
              </tr>
            )}
            {isPending && (
              <tr>
                <td colSpan={columns} className="py-8 text-muted">
                  Carregando…
                </td>
              </tr>
            )}
            {data?.data.length === 0 && (
              <tr>
                <td colSpan={columns} className="py-10 text-muted">
                  Nenhum lead com estes filtros.
                </td>
              </tr>
            )}
            {data?.data.map((lead) => (
              <tr
                key={lead.id}
                className="border-b border-rule align-top transition-colors hover:bg-paper-raised"
              >
                <td className="py-2.5 pr-4 whitespace-nowrap">
                  <time dateTime={lead.created_at} className="num block text-[13px]">
                    {formatDateTime(lead.created_at)}
                  </time>
                  <span className="text-xs text-muted">{formatRelative(lead.created_at)}</span>
                </td>
                <td className="py-2.5 pr-4">
                  {/* A real button: reachable with Tab, opens with Enter or Space. */}
                  <button
                    type="button"
                    onClick={() => openLead(lead.id)}
                    className="text-left font-medium underline decoration-rule-strong underline-offset-4 hover:decoration-accent"
                  >
                    {lead.name}
                  </button>
                </td>
                <td className="py-2.5 pr-4">
                  <span className="block max-w-[220px] truncate">{lead.email}</span>
                  <span className="num text-xs text-muted">{formatPhone(lead.phone)}</span>
                </td>
                <td className="py-2.5 pr-4 whitespace-nowrap">
                  {lead.product}
                  <span className="text-muted"> · {lead.funnel}</span>
                </td>
                <td className="py-2.5 pr-4 text-muted">{lead.source ?? '—'}</td>
                {showCallCenter && (
                  <td className="py-2.5 pr-4 whitespace-nowrap">
                    {lead.call_center ? (
                      lead.call_center.name
                    ) : (
                      <span className="text-accent">Pendente</span>
                    )}
                  </td>
                )}
                <td className="py-2.5">
                  <StatusMark status={lead.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav aria-label="Paginação" className="flex items-center justify-between gap-4 py-4">
        <p className="text-xs text-muted" aria-live="polite">
          Página <span className="num text-ink">{page}</span>
          {data && (
            <>
              {' '}
              · <span className="num">{data.data.length}</span> leads
            </>
          )}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn"
            disabled={cursors.length === 0}
            onClick={() => setCursors((stack) => stack.slice(0, -1))}
          >
            Anterior
          </button>
          <button
            type="button"
            className="btn"
            disabled={!data?.next_cursor || isPlaceholderData}
            onClick={() =>
              data?.next_cursor && setCursors((stack) => [...stack, data.next_cursor!])
            }
          >
            Próxima
          </button>
        </div>
      </nav>
    </>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th scope="col" className="label py-2 pr-4 font-medium">
      {children}
    </th>
  );
}
