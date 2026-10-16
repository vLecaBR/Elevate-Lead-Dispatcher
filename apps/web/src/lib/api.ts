// Thin client for the API behind the same-origin /api rewrite. Types mirror the explicit
// response shapes of the API; the front end never sees database rows.

export type Role = 'ADMIN' | 'OPERATOR';

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'no_answer',
  'callback',
  'qualified',
  'sale',
  'refund',
  'invalid',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  call_center_id: number | null;
}

export interface LeadListItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: LeadStatus;
  source: string | null;
  product: string;
  funnel: string;
  call_center: { slug: string; name: string } | null;
  created_at: string;
  status_updated_at: string;
}

export interface LeadPage {
  data: LeadListItem[];
  next_cursor: string | null;
}

export interface LeadDetail {
  lead: {
    id: string;
    name: string;
    email: string;
    phone: string;
    status: LeadStatus;
    status_updated_at: string;
    created_at: string;
    source: string | null;
    campaign: string | null;
    utm: Record<'source' | 'medium' | 'campaign' | 'content' | 'term', string | null>;
    product: { slug: string; name: string };
    funnel: { slug: string; name: string };
    affiliate_code: string | null;
    call_center: { id: number; slug: string; name: string } | null;
    distributed_at: string | null;
    external_id: string | null;
  };
  history: Array<{
    status: LeadStatus;
    event_ts: string;
    received_at: string;
    source: 'system' | 'webhook' | 'operator';
    note: string | null;
  }>;
  allowed_next: LeadStatus[];
}

export interface Catalog {
  products: Array<{ slug: string; name: string; funnels: Array<{ slug: string; name: string }> }>;
  call_centers: Array<{ id: number; slug: string; name: string }>;
  sources: string[];
  statuses: LeadStatus[];
}

export interface Metrics {
  total: number;
  today: number;
  distributed: number;
  pending: number;
  sales: number;
  conversion_rate: number;
  by_status: Record<LeadStatus, number>;
}

export interface DispatcherSummary {
  pending: number;
  call_centers: Array<{
    id: number;
    slug: string;
    name: string;
    weight: number;
    is_active: boolean;
    target_pct: number;
    distributed: number;
    actual_pct: number;
  }>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Every call goes through here: JSON in and out, the API's single error format turned into
// ApiError, and an expired session sent back to the login page (keeping where we were).
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && path !== '/api/auth/login' && typeof window !== 'undefined') {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.assign(`/login?next=${next}`);
    }
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'unknown_error',
      body?.error?.message ?? 'Erro inesperado',
    );
  }
  return body as T;
}
