import { z } from 'zod';
import { LEAD_STATUSES, type LeadStatus } from '../status/state-machine.js';

// `new` is the system's initial state; no transition leads to it, so a call center
// sending it is a client error, not an event to ignore.
const WEBHOOK_STATUSES = LEAD_STATUSES.filter(
  (status): status is Exclude<LeadStatus, 'new'> => status !== 'new',
);

// Machine-to-machine contract: strict (unknown keys are an error, unlike the public intake).
export const webhookPayloadSchema = z.strictObject({
  lead_id: z.uuid(),
  status: z.enum(WEBHOOK_STATUSES),
  // When it happened at the call center (ISO 8601 with offset). Stored as event_ts.
  timestamp: z.iso.datetime({ offset: true }),
  external_id: z.string().trim().min(1).max(128).optional(),
  event_id: z.string().trim().min(1).max(128).optional(),
  note: z.string().trim().max(500).optional(),
});

export type WebhookPayload = z.output<typeof webhookPayloadSchema>;
