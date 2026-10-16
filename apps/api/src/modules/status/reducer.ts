import { canTransition, type LeadStatus, STATUS_RANK } from './state-machine.js';

export interface StatusEvent {
  id: number;
  status: LeadStatus;
  eventTs: Date;
}

export interface ReducedStatus {
  status: LeadStatus;
  // event_ts of the event that produced the current status; null while still `new`.
  statusSince: Date | null;
}

// The event log is the truth; leads.status is a projection recomputed from all events.
// Events are replayed in event time (when it happened at the call center), not arrival
// time, so a late "contacted" cannot overwrite a "sale", and a "refund" that arrived
// before its "sale" takes effect once the sale shows up. Invalid transitions are skipped
// (kept in the log for audit). Same events in any arrival order => same result.
export function reduceStatus(events: readonly StatusEvent[]): ReducedStatus {
  const ordered = [...events].sort(
    (a, b) =>
      a.eventTs.getTime() - b.eventTs.getTime() ||
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      a.id - b.id,
  );

  let current: ReducedStatus = { status: 'new', statusSince: null };
  for (const event of ordered) {
    if (canTransition(current.status, event.status)) {
      current = { status: event.status, statusSince: event.eventTs };
    }
  }
  return current;
}
