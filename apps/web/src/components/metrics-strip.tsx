'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch, LEAD_STATUSES, type LeadStatus, type Metrics } from '@/lib/api';
import { formatInteger, formatRatio, STATUS_LABEL } from '@/lib/format';

// Tone per status for the composition bar only; every value is also written as text.
const STATUS_TONE: Record<LeadStatus, string> = {
  new: 'bg-rule-strong',
  contacted: 'bg-muted',
  no_answer: 'bg-muted/70',
  callback: 'bg-muted/50',
  qualified: 'bg-ink/80',
  sale: 'bg-positive',
  refund: 'bg-accent',
  invalid: 'bg-ink/30',
};

export function useMetrics() {
  return useQuery({
    queryKey: ['metrics'],
    queryFn: () => apiFetch<Metrics>('/api/dashboard/metrics'),
    refetchInterval: 30_000,
  });
}

export function MetricsStrip() {
  const { data, isError } = useMetrics();

  if (isError) {
    return (
      <p role="alert" className="py-6 text-danger">
        Não foi possível carregar as métricas.
      </p>
    );
  }

  const figures: Array<[string, string, string?]> = data
    ? [
        ['Total', formatInteger(data.total)],
        ['Hoje', formatInteger(data.today), 'desde 00h, horário de Brasília'],
        ['Distribuídos', formatInteger(data.distributed)],
        ['Pendentes', formatInteger(data.pending), 'aguardando distribuição'],
        ['Vendas', formatInteger(data.sales), 'status atual = venda'],
        ['Conversão', formatRatio(data.conversion_rate), 'vendas ÷ total'],
      ]
    : [];

  return (
    <section aria-labelledby="metrics-title" className="mt-6">
      <h2 id="metrics-title" className="sr-only">
        Métricas
      </h2>
      <dl
        aria-busy={!data}
        className="grid grid-cols-2 border-y border-rule sm:grid-cols-3 lg:grid-cols-6"
      >
        {(data ? figures : Array.from({ length: 6 }, () => ['', '—'] as [string, string])).map(
          ([label, value, hint], index) => (
            <div
              key={label || index}
              className="border-rule px-4 py-4 not-first:border-l max-lg:[&:nth-child(4)]:border-l-0 max-sm:[&:nth-child(odd)]:border-l-0 max-sm:[&:nth-child(n+3)]:border-t sm:max-lg:[&:nth-child(n+4)]:border-t"
            >
              <dt className="label">{label || ' '}</dt>
              <dd className="num mt-1.5 text-[26px] leading-none font-medium tracking-tight">
                {value}
              </dd>
              {hint && <dd className="mt-1.5 text-xs text-muted">{hint}</dd>}
            </div>
          ),
        )}
      </dl>

      {data && data.total > 0 && <StatusComposition counts={data.by_status} total={data.total} />}
    </section>
  );
}

function StatusComposition({
  counts,
  total,
}: {
  counts: Record<LeadStatus, number>;
  total: number;
}) {
  return (
    <div className="mt-4">
      <div aria-hidden="true" className="flex h-1.5 w-full overflow-hidden">
        {LEAD_STATUSES.map((status) =>
          counts[status] > 0 ? (
            <span
              key={status}
              className={STATUS_TONE[status]}
              style={{ width: `${(100 * counts[status]) / total}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        {LEAD_STATUSES.map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`inline-block size-2 ${STATUS_TONE[status]}`} />
            {STATUS_LABEL[status]}
            <span className="num text-ink">{formatInteger(counts[status])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
