import type { Db } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import { uuidv7 } from '../../shared/uuid.js';
import type { SessionUser } from '../auth/session.js';
import { insertStatusEvent } from '../status/repository.js';
import { recomputeStatus } from '../status/service.js';
import { allowedNext, canTransition, type LeadStatus } from '../status/state-machine.js';
import type { LeadScope } from './scope.js';
import { findLeadDetail, listLeadHistory, lockLeadInScope } from './scoped-repository.js';

const notFound = () => new AppError(404, 'lead_not_found', 'Lead not found');

export async function getLeadDetail(db: Db, scope: LeadScope, leadId: string) {
  const lead = await findLeadDetail(db, scope, leadId);
  if (!lead) {
    throw notFound();
  }
  const history = await listLeadHistory(db, scope, leadId);
  // The backend decides which statuses may come next; the UI only renders this list.
  return { lead, history, allowedNext: allowedNext(lead.status) };
}

// Manual change by a person (PLAN.md §9.3): same event log and reducer as the webhook,
// but validated against the CURRENT status first, so a human gets an immediate 409
// instead of an event silently ignored.
export async function changeStatusManually(
  db: Db,
  scope: LeadScope,
  user: SessionUser,
  leadId: string,
  change: { status: LeadStatus; note?: string },
): Promise<{ status: LeadStatus }> {
  return db.transaction(async (tx) => {
    const lead = await lockLeadInScope(tx, scope, leadId);
    if (!lead) {
      throw notFound();
    }
    if (!canTransition(lead.status, change.status)) {
      throw new AppError(
        409,
        'invalid_transition',
        `Cannot change status from ${lead.status} to ${change.status}`,
        [{ field: 'status', issue: 'invalid_transition' }],
      );
    }

    await insertStatusEvent(tx, {
      leadId: lead.id,
      status: change.status,
      // Server clock: the operator acts now.
      eventTs: new Date(),
      source: 'operator',
      callCenterId: user.callCenterId,
      actorUserId: user.id,
      // Every click is its own event (no dedupe across manual changes).
      eventKey: `operator:${uuidv7()}`,
      note: change.note ?? null,
    });
    const { status } = await recomputeStatus(tx, lead.id, lead.status);
    return { status };
  });
}
