import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPool, truncateAll } from '../helpers/db.js';

// These rules live in the database on purpose: they hold even if application code has a bug.
const pool = createTestPool();

afterAll(() => pool.end());
beforeEach(() => truncateAll(pool));

async function expectViolation(query: Promise<unknown>, constraint: string): Promise<void> {
  const error = await query.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(pg.DatabaseError);
  expect((error as pg.DatabaseError).constraint).toBe(constraint);
}

async function insertProduct(slug = 'nutralean'): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO products (slug, name) VALUES ($1, $1) RETURNING id',
    [slug],
  );
  return rows[0]!.id;
}

async function insertFunnel(productId: string, slug = 'vsl-01'): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO funnels (product_id, slug, name) VALUES ($1, $2, $2) RETURNING id',
    [productId, slug],
  );
  return rows[0]!.id;
}

function insertCallCenter(slug: string, weight: number) {
  return pool.query<{ id: number }>(
    `INSERT INTO call_centers (slug, name, weight, webhook_secret)
     VALUES ($1, $1, $2, 'secret') RETURNING id`,
    [slug, weight],
  );
}

function insertUser(email: string, role: 'ADMIN' | 'OPERATOR', callCenterId: number | null) {
  return pool.query(
    `INSERT INTO users (email, password_hash, role, call_center_id) VALUES ($1, 'hash', $2, $3)`,
    [email, role, callCenterId],
  );
}

async function insertLead(dedupeKey: string): Promise<string> {
  const productId = await insertProduct(`product-${randomUUID()}`);
  const funnelId = await insertFunnel(productId);
  const id = randomUUID();
  await pool.query(
    `INSERT INTO leads (id, name, email, phone_e164, product_id, funnel_id, dedupe_key, request_hash)
     VALUES ($1, 'Ana', 'ana@example.com', '+5511999990000', $2, $3, $4, 'hash')`,
    [id, productId, funnelId, dedupeKey],
  );
  return id;
}

describe('users: operator scope check', () => {
  it('rejects an OPERATOR without a call center', async () => {
    await expectViolation(
      insertUser('op@example.com', 'OPERATOR', null),
      'users_operator_call_center_check',
    );
  });

  it('rejects an ADMIN bound to a call center', async () => {
    const { rows } = await insertCallCenter('cc-a', 50);
    await expectViolation(
      insertUser('admin@example.com', 'ADMIN', rows[0]!.id),
      'users_operator_call_center_check',
    );
  });

  it('accepts an OPERATOR with a call center and an ADMIN without one', async () => {
    const { rows } = await insertCallCenter('cc-a', 50);
    await insertUser('op@example.com', 'OPERATOR', rows[0]!.id);
    await insertUser('admin@example.com', 'ADMIN', null);
  });

  it('rejects a duplicate e-mail', async () => {
    await insertUser('admin@example.com', 'ADMIN', null);
    await expectViolation(insertUser('admin@example.com', 'ADMIN', null), 'users_email_unique');
  });
});

describe('call_centers', () => {
  it('rejects a negative weight', async () => {
    await expectViolation(insertCallCenter('cc-a', -1), 'call_centers_weight_check');
  });

  it('accepts weight 0 (out of rotation)', async () => {
    await insertCallCenter('cc-a', 0);
  });
});

describe('funnels', () => {
  it('rejects the same slug twice for one product but allows it on another product', async () => {
    const nutralean = await insertProduct('nutralean');
    const glicofit = await insertProduct('glicofit');
    await insertFunnel(nutralean, 'vsl-01');

    await insertFunnel(glicofit, 'vsl-01');
    await expectViolation(insertFunnel(nutralean, 'vsl-01'), 'funnels_product_id_slug_unique');
  });
});

describe('leads and their history', () => {
  it('rejects a duplicate dedupe_key', async () => {
    await insertLead('fp:same');
    await expectViolation(insertLead('fp:same'), 'leads_dedupe_key_unique');
  });

  it('allows at most one distribution per lead', async () => {
    const leadId = await insertLead('fp:one');
    const { rows } = await insertCallCenter('cc-a', 50);
    const distribute = () =>
      pool.query(
        `INSERT INTO distributions (lead_id, call_center_id, strategy, weights_snapshot)
         VALUES ($1, $2, 'swrr', '{}')`,
        [leadId, rows[0]!.id],
      );

    await distribute();
    await expectViolation(distribute(), 'distributions_lead_id_unique');
  });

  it('rejects the same event_key twice for one lead (webhook dedupe)', async () => {
    const leadId = await insertLead('fp:events');
    const addEvent = () =>
      pool.query(
        `INSERT INTO lead_status_events (lead_id, status, event_ts, source, event_key)
         VALUES ($1, 'contacted', now(), 'webhook', 'key-1')`,
        [leadId],
      );

    await addEvent();
    await expectViolation(addEvent(), 'lead_status_events_lead_id_event_key_unique');
  });
});
