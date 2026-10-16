'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { AdminOnly } from '@/components/admin-only';
import { PageHeader } from '@/components/page-header';
import { ApiError, apiFetch, type DispatcherSummary } from '@/lib/api';
import { formatInteger, formatPercent } from '@/lib/format';

type CallCenter = DispatcherSummary['call_centers'][number];

// Segment tones for the split bars, by position. The numbers are always written next to
// the bars, so the tones are only a visual aid.
const TONES = ['bg-ink', 'bg-muted', 'bg-rule-strong', 'bg-accent', 'bg-positive'];

export default function DispatcherPage() {
  return (
    <AdminOnly>
      <DispatcherPageContent />
    </AdminOnly>
  );
}

function DispatcherPageContent() {
  const { data, isError } = useQuery({
    queryKey: ['dispatcher'],
    queryFn: () => apiFetch<DispatcherSummary>('/api/admin/dispatcher'),
    refetchInterval: 15_000,
  });

  return (
    <>
      <PageHeader
        kicker="Dispatcher"
        title="Distribuição entre call centers"
        aside={data && <Redistribute pending={data.pending} />}
      />
      {isError && (
        <p role="alert" className="py-6 text-danger">
          Não foi possível carregar o dispatcher.
        </p>
      )}
      {data && (
        <>
          <Split centers={data.call_centers} />
          <ConfigTable centers={data.call_centers} />
        </>
      )}
    </>
  );
}

// Target (from the weights) over actual (from what was dispatched): the gap is visible at a
// glance, and SWRR keeps it near zero.
function Split({ centers }: { centers: CallCenter[] }) {
  const rows: Array<[string, (c: CallCenter) => number]> = [
    ['Alvo', (c) => c.target_pct],
    ['Real', (c) => c.actual_pct],
  ];
  return (
    <section aria-labelledby="split-title" className="mt-6">
      <h2 id="split-title" className="label">
        Alvo × real
      </h2>
      <div aria-hidden="true" className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[3rem_1fr] items-center gap-3">
            <span className="text-xs text-muted">{label}</span>
            <div className="flex h-3 w-full overflow-hidden bg-rule">
              {centers.map((center, index) =>
                value(center) > 0 ? (
                  <span
                    key={center.id}
                    className={`${TONES[index % TONES.length]} border-r border-paper last:border-r-0`}
                    style={{ width: `${value(center)}%` }}
                  />
                ) : null,
              )}
            </div>
          </div>
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
        {centers.map((center, index) => (
          <li key={center.id} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`inline-block size-2 ${TONES[index % TONES.length]}`}
            />
            <span className="text-ink">{center.name}</span>
            alvo <span className="num text-ink">{formatPercent(center.target_pct)}</span>· real{' '}
            <span className="num text-ink">{formatPercent(center.actual_pct)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConfigTable({ centers }: { centers: CallCenter[] }) {
  const [announcement, setAnnouncement] = useState('');

  return (
    <section aria-labelledby="config-title" className="mt-10">
      <h2 id="config-title" className="label">
        Configuração
      </h2>
      <p className="mt-1 max-w-[70ch] text-xs text-muted">
        Pesos são relativos (não precisam somar 100). Peso 0 ou inativo tira o call center da
        rotação. Qualquer alteração zera os créditos de todos: a rotação recomeça equilibrada.
      </p>
      <div
        className="mt-3 overflow-x-auto"
        role="region"
        aria-label="Configuração dos call centers"
        tabIndex={0}
      >
        <table className="w-full min-w-[720px] border-collapse text-left">
          <caption className="sr-only">Peso, situação e distribuição de cada call center</caption>
          <thead>
            <tr className="border-b border-rule-strong">
              <th scope="col" className="label py-2 pr-4 font-medium">
                Call center
              </th>
              <th scope="col" className="label py-2 pr-4 font-medium">
                Peso
              </th>
              <th scope="col" className="label py-2 pr-4 font-medium">
                Ativo
              </th>
              <th scope="col" className="label py-2 pr-4 text-right font-medium">
                Alvo
              </th>
              <th scope="col" className="label py-2 pr-4 text-right font-medium">
                Real
              </th>
              <th scope="col" className="label py-2 pr-4 text-right font-medium">
                Leads
              </th>
              <th scope="col" className="label py-2 font-medium">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {centers.map((center) => (
              // Keyed by the saved values: after a save the row starts clean again.
              <ConfigRow
                key={`${center.id}-${center.weight}-${center.is_active}`}
                center={center}
                onSaved={setAnnouncement}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p aria-live="polite" className="mt-3 text-positive">
        {announcement}
      </p>
    </section>
  );
}

function ConfigRow({
  center,
  onSaved,
}: {
  center: CallCenter;
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [weight, setWeight] = useState(String(center.weight));
  const [active, setActive] = useState(center.is_active);
  const weightNumber = Number(weight);
  const weightValid =
    weight !== '' && Number.isInteger(weightNumber) && weightNumber >= 0 && weightNumber <= 1000;
  const dirty = weightNumber !== center.weight || active !== center.is_active;

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/api/admin/call-centers/${center.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ weight: weightNumber, is_active: active }),
      }),
    onSuccess: async () => {
      onSaved(
        `${center.name}: peso ${weightNumber}, ${active ? 'ativo' : 'inativo'}. Créditos zerados.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['dispatcher'] });
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (dirty && weightValid) save.mutate();
  }

  const formId = `cc-form-${center.id}`;
  return (
    <tr className="border-b border-rule align-middle">
      <th scope="row" className="py-2.5 pr-4 text-left font-medium">
        {center.name}
        <span className="num block text-xs font-normal text-muted">{center.slug}</span>
      </th>
      <td className="py-2.5 pr-4">
        <label htmlFor={`weight-${center.id}`} className="sr-only">
          Peso de {center.name}
        </label>
        <input
          id={`weight-${center.id}`}
          form={formId}
          type="number"
          inputMode="numeric"
          min={0}
          max={1000}
          step={1}
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          aria-invalid={!weightValid}
          className="field num w-24"
        />
      </td>
      <td className="py-2.5 pr-4">
        <label className="inline-flex min-h-6 items-center gap-2">
          <input
            form={formId}
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          <span className="sr-only">{center.name} ativo</span>
          <span aria-hidden="true">{active ? 'Sim' : 'Não'}</span>
        </label>
      </td>
      <td className="num py-2.5 pr-4 text-right">{formatPercent(center.target_pct)}</td>
      <td className="num py-2.5 pr-4 text-right">{formatPercent(center.actual_pct)}</td>
      <td className="num py-2.5 pr-4 text-right">{formatInteger(center.distributed)}</td>
      <td className="py-2.5 text-right">
        <form id={formId} onSubmit={onSubmit} className="inline-flex flex-col items-end gap-1">
          <button type="submit" className="btn" disabled={!dirty || !weightValid || save.isPending}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
          {save.isError && (
            <span role="alert" className="text-xs text-danger">
              {save.error instanceof ApiError && save.error.status === 422
                ? 'Valor inválido'
                : 'Falha ao salvar'}
            </span>
          )}
        </form>
      </td>
    </tr>
  );
}

function Redistribute({ pending }: { pending: number }) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState('');
  const run = useMutation({
    mutationFn: () =>
      apiFetch<{ distributed: number; remaining: number }>(
        '/api/admin/dispatcher/redispatch-pending',
        { method: 'POST' },
      ),
    onSuccess: async ({ distributed, remaining }) => {
      setResult(
        `${formatInteger(distributed)} distribuídos · ${formatInteger(remaining)} pendentes`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dispatcher'] }),
        queryClient.invalidateQueries({ queryKey: ['metrics'] }),
        queryClient.invalidateQueries({ queryKey: ['leads'] }),
      ]);
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-4">
      <p className="text-right">
        <span className="label block">Pendentes</span>
        <span className="num text-xl font-medium">{formatInteger(pending)}</span>
      </p>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending === 0 || run.isPending}
          onClick={() => run.mutate()}
        >
          {run.isPending ? 'Distribuindo…' : 'Distribuir pendentes'}
        </button>
        <span aria-live="polite" className="text-xs text-muted">
          {run.isError ? 'Falha ao distribuir.' : result}
        </span>
      </div>
    </div>
  );
}
