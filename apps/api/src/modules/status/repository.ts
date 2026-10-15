import type { Tx } from '../../db/client.js';
import { leadStatusEvents } from '../../db/schema.js';

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
