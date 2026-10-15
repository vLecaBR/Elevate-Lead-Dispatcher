import { createHash } from 'node:crypto';
import type { LeadInput } from './schema.js';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// One UNIQUE column, two ways to fill it (PLAN.md §7):
// - with Idempotency-Key: the client decides what "the same request" is;
// - without it: same person (email + phone) in the same product funnel = same lead.
// Fields are hashed as a JSON array, not joined with "|", so a value containing the
// separator cannot collide with a different split of the same characters.
export function buildDedupeKey(lead: LeadInput, idempotencyKey: string | undefined): string {
  if (idempotencyKey !== undefined) {
    return `idem:${sha256(idempotencyKey)}`;
  }
  return `fp:${sha256(JSON.stringify([lead.product, lead.funnel, lead.email, lead.phoneE164]))}`;
}

// Hash of the normalized input, used to detect an Idempotency-Key reused with a different
// body. Keys are sorted so the same data in another order hashes the same.
export function buildRequestHash(lead: LeadInput): string {
  return sha256(JSON.stringify(sortKeys(lead)));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sortKeys(v)]),
  );
}
