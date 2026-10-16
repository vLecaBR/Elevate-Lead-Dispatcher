import type pg from 'pg';
import { uuidv7 } from '../../src/shared/uuid.js';

export interface FixtureLead {
  // Any timestamptz literal, e.g. '2026-10-15 12:00:00.000001-03'.
  createdAt: string;
  callCenter?: string | null; // slug; null = pending
  status?: string;
  source?: string;
  product?: string;
  funnel?: string;
}

// Inserts a lead directly with a chosen created_at (the intake always uses now()), for
// list, filter and metrics tests. Requires the demo seed (products, funnels, call centers).
export async function insertLead(pool: pg.Pool, lead: FixtureLead): Promise<string> {
  const id = uuidv7();
  await pool.query(
    `INSERT INTO leads (id, name, email, phone_e164, product_id, funnel_id, source, status,
                        call_center_id, distributed_at, dedupe_key, request_hash, created_at)
     SELECT $1, 'Lead', $8, '+5511987654321', p.id, f.id, $2, $3,
            c.id, CASE WHEN c.id IS NULL THEN NULL ELSE $4::timestamptz END,
            $9, 'hash', $4::timestamptz
     FROM products p
     JOIN funnels f ON f.product_id = p.id AND f.slug = $6
     LEFT JOIN call_centers c ON c.slug = $7
     WHERE p.slug = $5`,
    [
      id,
      lead.source ?? 'facebook',
      lead.status ?? 'new',
      lead.createdAt,
      lead.product ?? 'nutralean',
      lead.funnel ?? 'vsl-01',
      lead.callCenter === undefined ? 'cc-a' : lead.callCenter,
      `${id}@example.com`,
      `fixture:${id}`,
    ],
  );
  return id;
}
