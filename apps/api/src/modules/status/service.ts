import type { Tx } from '../../db/client.js';
import { reduceStatus } from './reducer.js';
import { listStatusEvents, updateLeadStatus } from './repository.js';
import type { LeadStatus } from './state-machine.js';

// Recomputes the leads.status projection from the whole event log of the lead. Must run
// in the transaction that holds the lead's row lock (see lockLeadForUpdate) and after the
// new event was inserted. A lead has few events, so replaying all of them is cheap and
// keeps the result independent of arrival order.
export async function recomputeStatus(
  tx: Tx,
  leadId: string,
  currentStatus: LeadStatus,
): Promise<{ status: LeadStatus; changed: boolean }> {
  const { status } = reduceStatus(await listStatusEvents(tx, leadId));
  if (status === currentStatus) {
    return { status, changed: false };
  }
  await updateLeadStatus(tx, leadId, status);
  return { status, changed: true };
}
