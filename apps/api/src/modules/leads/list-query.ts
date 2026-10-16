import { z } from 'zod';
import { LEAD_STATUSES } from '../status/state-machine.js';

const slug = z.string().trim().toLowerCase().min(1).max(64);

// Whitelist of list filters (PLAN.md §11). Strict: an unknown parameter is a 422, so a
// typo like ?stauts=sale does not silently return every lead.
export const listQuerySchema = z
  .strictObject({
    from: z.iso.date().optional(), // YYYY-MM-DD, inclusive, in APP_TIMEZONE
    to: z.iso.date().optional(), // YYYY-MM-DD, inclusive, in APP_TIMEZONE
    product: slug.optional(),
    funnel: slug.optional(),
    source: slug.optional(),
    call_center: slug.optional(),
    status: z.enum(LEAD_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(200).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    path: ['to'],
    message: 'to_before_from',
  });

export type ListQuery = z.output<typeof listQuerySchema>;

// Position of the last row of a page: (created_at, id), the keyset sort key.
export interface Cursor {
  // Postgres text form of created_at, with full microsecond precision. A JS Date would
  // truncate to milliseconds, and the next page would skip or repeat rows that differ
  // only in the microseconds.
  createdAt: string;
  id: string;
}

const TIMESTAMP_TEXT =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/;
const cursorSchema = z.tuple([z.string().regex(TIMESTAMP_TEXT), z.uuid()]);

// Opaque to clients: base64url of [created_at, id].
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id])).toString('base64url');
}

// null when the cursor was not produced by encodeCursor (or was tampered into garbage).
export function decodeCursor(value: string): Cursor | null {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString()));
    return parsed.success ? { createdAt: parsed.data[0], id: parsed.data[1] } : null;
  } catch {
    return null;
  }
}
