'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch, type LeadDetail, type LeadStatus } from '@/lib/api';
import {
  formatDateTime,
  formatFullDateTime,
  formatPhone,
  SOURCE_LABEL,
  STATUS_LABEL,
} from '@/lib/format';
import { StatusMark } from './status-mark';

// The open lead lives in the URL (?lead=<id>): the back button closes it and the link can be
// shared. A native <dialog> opened with showModal() gives focus trapping, Esc to close and
// an inert background without any library.
export function LeadDialog() {
  const params = useSearchParams();
  const leadId = params.get('lead');
  const router = useRouter();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Element that had focus before opening (the lead's name button), to give focus back.
  const returnFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (leadId && !dialog.open) {
      returnFocusRef.current = document.activeElement;
      dialog.showModal();
    } else if (!leadId && dialog.open) {
      dialog.close();
    }
  }, [leadId]);

  function onClose() {
    const search = new URLSearchParams(params);
    search.delete('lead');
    const query = search.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    const target = returnFocusRef.current;
    if (target instanceof HTMLElement && target.isConnected) {
      target.focus();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-labelledby="lead-title"
      onClose={onClose}
      // Click on the backdrop (the dialog element itself, outside its content) closes it.
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      {leadId && <LeadSheet leadId={leadId} onClose={() => dialogRef.current?.close()} />}
    </dialog>
  );
}

function LeadSheet({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => apiFetch<LeadDetail>(`/api/leads/${leadId}`),
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-ink px-6 pt-5 pb-3">
        <div className="min-w-0">
          <p className="label">Lead</p>
          <h2 id="lead-title" className="mt-1 truncate text-xl font-semibold tracking-tight">
            {data?.lead.name ?? (isError ? 'Lead indisponível' : 'Carregando…')}
          </h2>
        </div>
        <button type="button" onClick={onClose} className="btn btn-quiet -mr-3 shrink-0">
          Fechar <kbd className="num text-xs text-muted">Esc</kbd>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-10">
        {isPending && <p className="py-6 text-muted">Carregando…</p>}
        {isError && (
          <p role="alert" className="py-6 text-danger">
            {error instanceof ApiError && error.status === 404
              ? 'Este lead não existe ou não pertence ao seu call center.'
              : 'Não foi possível carregar o lead.'}
          </p>
        )}
        {data && (
          <>
            <StatusSection detail={data} />
            <Facts detail={data} />
            <History history={data.history} />
          </>
        )}
      </div>
    </div>
  );
}

function StatusSection({ detail }: { detail: LeadDetail }) {
  const { lead, allowed_next: allowedNext } = detail;
  const queryClient = useQueryClient();
  const [next, setNext] = useState<LeadStatus | ''>('');
  const [note, setNote] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const change = useMutation({
    mutationFn: (body: { status: LeadStatus; note?: string }) =>
      apiFetch<{ status: LeadStatus }>(`/api/leads/${lead.id}/status`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: async (result) => {
      setConfirmation(`Status alterado para ${STATUS_LABEL[result.status]}.`);
      setNext('');
      setNote('');
      // The change shows up in the detail, the table and the metrics.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lead', lead.id] }),
        queryClient.invalidateQueries({ queryKey: ['leads'] }),
        queryClient.invalidateQueries({ queryKey: ['metrics'] }),
      ]);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!next) return;
    setConfirmation('');
    change.mutate({ status: next, ...(note.trim() ? { note: note.trim() } : {}) });
  }

  return (
    <section aria-labelledby="status-title" className="border-b border-rule py-5">
      <h3 id="status-title" className="label">
        Status
      </h3>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 text-lg">
        <StatusMark status={lead.status} />
        <span className="text-xs text-muted">
          desde <span className="num">{formatDateTime(lead.status_updated_at)}</span>
        </span>
      </div>

      {allowedNext.length === 0 ? (
        <p className="mt-3 text-muted">Status final: não há próximas etapas.</p>
      ) : (
        <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label htmlFor="next-status" className="label mb-1 block">
              Novo status
            </label>
            {/* Only what the API allows next: the state machine lives in the backend. */}
            <select
              id="next-status"
              value={next}
              onChange={(event) => setNext(event.target.value as LeadStatus)}
              className="field"
              required
            >
              <option value="">Escolha…</option>
              {allowedNext.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn btn-primary" disabled={!next || change.isPending}>
              {change.isPending ? 'Registrando…' : 'Registrar'}
            </button>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="status-note" className="label mb-1 block">
              Observação <span className="normal-case tracking-normal">(opcional)</span>
            </label>
            <textarea
              id="status-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              rows={2}
              className="field resize-y"
            />
          </div>
        </form>
      )}

      <p aria-live="polite" className="mt-2 text-positive">
        {confirmation}
      </p>
      {change.isError && (
        <p role="alert" className="mt-2 text-danger">
          {change.error instanceof ApiError && change.error.code === 'status_superseded'
            ? 'Um evento mais recente do call center mantém o status atual. Nada foi alterado.'
            : change.error instanceof ApiError && change.error.status === 409
              ? 'O status mudou enquanto você editava. Atualize e escolha de novo.'
              : 'Não foi possível alterar o status.'}
        </p>
      )}
    </section>
  );
}

function Facts({ detail }: { detail: LeadDetail }) {
  const { lead } = detail;
  const utm = Object.entries(lead.utm).filter(([, value]) => value);

  const rows: Array<[string, ReactNode]> = [
    [
      'E-mail',
      <a key="e" href={`mailto:${lead.email}`} className="underline underline-offset-4">
        {lead.email}
      </a>,
    ],
    [
      'Telefone',
      <a key="t" href={`tel:${lead.phone}`} className="num underline underline-offset-4">
        {formatPhone(lead.phone)}
      </a>,
    ],
    ['Produto', `${lead.product.name} · ${lead.funnel.slug}`],
    ['Origem', lead.source ?? '—'],
    ['Campanha', lead.campaign ?? '—'],
    ['UTM', utm.length ? utm.map(([key, value]) => `${key}=${value}`).join('  ') : '—'],
    ['Afiliado', lead.affiliate_code ?? '—'],
    ['Call center', lead.call_center?.name ?? 'Pendente'],
    [
      'Recebido',
      <span key="r" className="num">
        {formatFullDateTime(lead.created_at)}
      </span>,
    ],
    [
      'Distribuído',
      lead.distributed_at ? (
        <span key="d" className="num">
          {formatFullDateTime(lead.distributed_at)}
        </span>
      ) : (
        '—'
      ),
    ],
    ['ID no call center', lead.external_id ?? '—'],
    [
      'ID',
      <span key="i" className="num text-xs break-all">
        {lead.id}
      </span>,
    ],
  ];

  return (
    <section aria-labelledby="facts-title" className="border-b border-rule py-5">
      <h3 id="facts-title" className="label">
        Dados
      </h3>
      <dl className="mt-2 grid grid-cols-[9rem_1fr] gap-x-4 gap-y-1.5">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted">{term}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function History({ history }: { history: LeadDetail['history'] }) {
  return (
    <section aria-labelledby="history-title" className="py-5">
      <h3 id="history-title" className="label">
        Histórico
      </h3>
      <p className="mt-1 text-xs text-muted">
        Em ordem de acontecimento. Eventos que chegaram fora de ordem aparecem no lugar certo.
      </p>
      <ol className="mt-3 border-l border-rule-strong">
        {history.map((event, index) => {
          // Shows when the call center reported it later than it happened (more than 1 min).
          const late =
            new Date(event.received_at).getTime() - new Date(event.event_ts).getTime() > 60_000;
          return (
            <li key={`${event.event_ts}-${index}`} className="relative pb-4 pl-5 last:pb-0">
              <span
                aria-hidden="true"
                className="absolute top-[7px] -left-[4.5px] size-2 border border-rule-strong bg-paper"
              />
              <div className="flex flex-wrap items-baseline gap-x-3">
                <time dateTime={event.event_ts} className="num text-[13px]">
                  {formatDateTime(event.event_ts)}
                </time>
                <StatusMark status={event.status} />
                <span className="text-xs text-muted">{SOURCE_LABEL[event.source]}</span>
              </div>
              {late && (
                <p className="mt-0.5 text-xs text-muted">
                  recebido em <span className="num">{formatDateTime(event.received_at)}</span>
                </p>
              )}
              {event.note && <p className="mt-1 max-w-[52ch]">{event.note}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
