import type { LeadStatus } from './api';

const TIME_ZONE = 'America/Sao_Paulo';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const fullDateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIME_ZONE,
  dateStyle: 'short',
  timeStyle: 'medium',
});
const integer = new Intl.NumberFormat('pt-BR');
const percentFormat = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});
const relative = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto', style: 'short' });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso)).replace(',', '');
export const formatFullDateTime = (iso: string) => fullDateTime.format(new Date(iso));
export const formatInteger = (value: number) => integer.format(value);
export const formatRatio = (ratio: number) => percentFormat.format(ratio);
export const formatPercent = (value: number) => percentFormat.format(value / 100);

// "há 4 min", "há 3 h", "há 2 dias": the absolute date stays next to it.
export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(seconds, 'second');
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86_400), 'day');
}

// +5511987654321 -> +55 (11) 98765-4321. Other countries keep the E.164 form.
export function formatPhone(e164: string): string {
  const br = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return br ? `+55 (${br[1]}) ${br[2]}-${br[3]}` : e164;
}

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'Novo',
  contacted: 'Contatado',
  no_answer: 'Sem resposta',
  callback: 'Retornar',
  qualified: 'Qualificado',
  sale: 'Venda',
  refund: 'Reembolso',
  invalid: 'Inválido',
};

export const SOURCE_LABEL = {
  system: 'Sistema',
  webhook: 'Call center',
  operator: 'Operador',
} as const;
