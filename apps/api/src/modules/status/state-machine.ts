// Lead status lifecycle (PLAN.md §9.3). Pure: also the single source of the status list,
// which the database enum (db/schema.ts) is built from.

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

// new -> sale is allowed on purpose: a call center may skip or lose intermediate events.
// refund only follows a sale; refund and invalid are terminal.
const transitions: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ['contacted', 'no_answer', 'callback', 'qualified', 'sale', 'invalid'],
  contacted: ['no_answer', 'callback', 'qualified', 'sale', 'invalid'],
  no_answer: ['contacted', 'callback', 'qualified', 'sale', 'invalid'],
  callback: ['contacted', 'no_answer', 'qualified', 'sale', 'invalid'],
  qualified: ['callback', 'sale', 'invalid'],
  sale: ['refund'],
  refund: [],
  invalid: [],
};

// The same status again is a no-op, not a transition.
export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  return transitions[from].includes(to);
}

export function allowedNext(from: LeadStatus): readonly LeadStatus[] {
  return transitions[from];
}

export function isTerminal(status: LeadStatus): boolean {
  return transitions[status].length === 0;
}

// Tie-breaker for events with the same timestamp. Every status has a distinct rank, so two
// events can only tie on (event_ts, rank) when they carry the same status, and then their
// order cannot change the outcome. Later stages rank higher: at the same instant,
// "contacted" is applied before "sale".
export const STATUS_RANK: Record<LeadStatus, number> = {
  new: 0,
  contacted: 1,
  no_answer: 2,
  callback: 3,
  qualified: 4,
  sale: 5,
  refund: 6,
  invalid: 7,
};
