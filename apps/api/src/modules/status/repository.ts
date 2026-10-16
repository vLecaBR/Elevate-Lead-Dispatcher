import { eq, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { leads, leadStatusEvents } from '../../db/schema.js';
import type { StatusEvent } from './reducer.js';
import type { LeadStatus } from './state-machine.js';

export type NewStatusEvent = typeof leadStatusEvents.$inferInsert;

// Returns false when (lead_id, event_key) already exists: the event was a duplicate.
export async function insertStatusEvent(tx: Tx, event: NewStatusEvent): Promise<boolean> {
  const inserted = await tx
    .insert(leadStatusEvents)
    .values(event)
    .onConflictDoNothing({ target: [leadStatusEvents.leadId, leadStatusEvents.eventKey] })
    .returning({ id: leadStatusEvents.id });
  return inserted.length > 0;
}

// Row lock on the lead: status updates of the same lead run one at a time, so two
// concurrent events cannot both read the old history and write conflicting projections.
// Different leads do not block each other. Lock order: lead, then its events.
export async function lockLeadForUpdate(
  tx: Tx,
  leadId: string,
): Promise<{ id: string; callCenterId: number | null; status: LeadStatus } | undefined> {
  const [row] = await tx
    .select({ id: leads.id, callCenterId: leads.callCenterId, status: leads.status })
    .from(leads)
    .where(eq(leads.id, leadId))
    .for('update');
  return row;
}

// Served by lead_status_events_lead_id_event_ts_idx; order is the reducer's job.
export async function listStatusEvents(tx: Tx, leadId: string): Promise<StatusEvent[]> {
  return tx
    .select({
      id: leadStatusEvents.id,
      status: leadStatusEvents.status,
      eventTs: leadStatusEvents.eventTs,
    })
    .from(leadStatusEvents)
    .where(eq(leadStatusEvents.leadId, leadId));
}

export async function updateLeadStatus(tx: Tx, leadId: string, status: LeadStatus): Promise<void> {
  await tx
    .update(leads)
    .set({ status, statusUpdatedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(leads.id, leadId));
}
