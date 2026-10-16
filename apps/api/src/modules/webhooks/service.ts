import { createHash } from 'node:crypto';
import type { Db } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import { insertStatusEvent, lockLeadForUpdate } from '../status/repository.js';
import { recomputeStatus } from '../status/service.js';
import { getDistributionExternalId, setDistributionExternalId } from './repository.js';
import type { WebhookPayload } from './schema.js';

export type WebhookResult = 'applied' | 'ignored' | 'duplicate';

export interface WebhookOutcome {
  result: WebhookResult;
  // The call center sent an external_id different from the one already on record.
  externalIdConflict: boolean;
}

// Identity of an event for dedupe: the same call center reporting the same status at the
// same instant for the same external record is the same event, however many times it is
// delivered. Timestamps are normalized to UTC so "+00:00" and "Z" do not differ.
export function buildEventKey(callCenterId: number, payload: WebhookPayload): string {
  const parts = [
    callCenterId,
    payload.external_id ?? null,
    payload.status,
    new Date(payload.event_ts).toISOString(),
    payload.event_id ?? null,
  ];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export async function handleStatusWebhook(
  db: Db,
  callCenterId: number,
  payload: WebhookPayload,
): Promise<WebhookOutcome> {
  return db.transaction(async (tx) => {
    // Lock first: concurrent webhooks for this lead queue here (PLAN.md §9.2).
    const lead = await lockLeadForUpdate(tx, payload.lead_id);
    // A call center may only touch leads dispatched to it. Someone else's lead answers
    // exactly like a missing one, so lead ids of other call centers cannot be probed.
    if (!lead || lead.callCenterId !== callCenterId) {
      throw new AppError(404, 'lead_not_found', 'Lead not found');
    }

    const inserted = await insertStatusEvent(tx, {
      leadId: lead.id,
      status: payload.status,
      eventTs: new Date(payload.event_ts),
      source: 'webhook',
      callCenterId,
      externalId: payload.external_id ?? null,
      eventKey: buildEventKey(callCenterId, payload),
      payload,
      note: payload.note ?? null,
    });
    if (!inserted) {
      // Already recorded: answer 2xx so the provider stops retrying, change nothing.
      return { result: 'duplicate', externalIdConflict: false };
    }

    let externalIdConflict = false;
    if (payload.external_id) {
      // First external_id wins on the distribution; a different one later stays on the
      // event only (audit) and is reported, never silently overwritten.
      const current = await getDistributionExternalId(tx, lead.id);
      if (current === null) {
        await setDistributionExternalId(tx, lead.id, payload.external_id);
      } else if (current !== undefined && current !== payload.external_id) {
        externalIdConflict = true;
      }
    }

    // The event is stored either way; whether it moved the projection is what we report.
    const { changed } = await recomputeStatus(tx, lead.id, lead.status);
    return { result: changed ? 'applied' : 'ignored', externalIdConflict };
  });
}
