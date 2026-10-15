import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { seedDemo } from '../../src/db/seed.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { truncateAll } from '../helpers/db.js';

let t: TestApp;

const validLead = {
  name: 'Ana Souza',
  email: 'ana@example.com',
  phone: '+55 11 98765-4321',
  product: 'nutralean',
  funnel: 'vsl-01',
  source: 'facebook',
  campaign: 'bf-2026',
  utm: { source: 'fb', medium: 'cpc' },
};

function postLead(body: unknown, headers: Record<string, string> = {}) {
  return t.app.inject({ method: 'POST', url: '/api/leads', payload: body as object, headers });
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await t.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${sql}`,
    params,
  );
  return rows[0]!.n;
}

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await truncateAll(t.pool);
  await seedDemo(createDb(t.pool));
});

describe('POST /api/leads: creation', () => {
  it('creates a pending lead with normalized data and its first history event', async () => {
    const response = await postLead({ ...validLead, email: ' ANA@Example.com ' });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toEqual({ success: true, lead_id: expect.any(String), duplicate: false });
    expect(body.lead_id[14]).toBe('7'); // UUIDv7

    const { rows } = await t.pool.query(
      `SELECT l.email, l.phone_e164, l.status, l.call_center_id, l.source, l.utm_source, p.slug AS product
       FROM leads l JOIN products p ON p.id = l.product_id WHERE l.id = $1`,
      [body.lead_id],
    );
    expect(rows[0]).toEqual({
      email: 'ana@example.com',
      phone_e164: '+5511987654321',
      status: 'new',
      call_center_id: null, // pending until the dispatcher exists (phase 4)
      source: 'facebook',
      utm_source: 'fb',
      product: 'nutralean',
    });
    expect(
      await count(
        `lead_status_events WHERE lead_id = $1 AND status = 'new' AND source = 'system'`,
        [body.lead_id],
      ),
    ).toBe(1);
  });

  it('ignores unknown top-level fields', async () => {
    const response = await postLead({ ...validLead, gclid: 'xyz', referrer: 'google' });

    expect(response.statusCode).toBe(201);
  });

  it('creates an unknown affiliate on first sight and reuses it afterwards', async () => {
    await postLead({ ...validLead, affiliate_id: 'aff-77' });
    await postLead({ ...validLead, email: 'bia@example.com', affiliate_id: 'aff-77' });

    expect(await count(`affiliates WHERE external_code = 'aff-77'`)).toBe(1);
    expect(
      await count(
        `leads l JOIN affiliates a ON a.id = l.affiliate_id WHERE a.external_code = 'aff-77'`,
      ),
    ).toBe(2);
  });
});

describe('POST /api/leads: duplicates and idempotency', () => {
  it('answers a replay without Idempotency-Key with 200 and the same lead_id', async () => {
    const first = (await postLead(validLead)).json();
    const replay = await postLead({ ...validLead, name: 'Ana S.', source: 'google' });

    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ success: true, lead_id: first.lead_id, duplicate: true });
    expect(await count('leads')).toBe(1);
    expect(await count('lead_status_events')).toBe(1);
  });

  it('treats the same person in another funnel as a new lead', async () => {
    await postLead(validLead);
    const other = await postLead({ ...validLead, funnel: 'vsl-02' });

    expect(other.statusCode).toBe(201);
    expect(await count('leads')).toBe(2);
  });

  it('answers the same Idempotency-Key and body with 200 and the same lead_id', async () => {
    const headers = { 'idempotency-key': 'order-1' };
    const first = (await postLead(validLead, headers)).json();
    // Same data, different formatting: still the same request after normalization.
    const replay = await postLead({ ...validLead, email: 'ANA@example.com' }, headers);

    expect(replay.statusCode).toBe(200);
    expect(replay.json().lead_id).toBe(first.lead_id);
  });

  it('rejects the same Idempotency-Key with a different body (422)', async () => {
    const headers = { 'idempotency-key': 'order-2' };
    await postLead(validLead, headers);
    const reuse = await postLead({ ...validLead, campaign: 'other' }, headers);

    expect(reuse.statusCode).toBe(422);
    expect(reuse.json().error.code).toBe('idempotency_key_reuse');
    expect(await count('leads')).toBe(1);
  });

  it('rejects an Idempotency-Key that is too long', async () => {
    const response = await postLead(validLead, { 'idempotency-key': 'k'.repeat(256) });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.details).toEqual([
      { field: 'header.idempotency-key', issue: 'too_big' },
    ]);
  });
});

describe('POST /api/leads: validation (422)', () => {
  it('lists every invalid field in details', async () => {
    const response = await postLead({
      ...validLead,
      phone: '123',
      email: 'x',
      utm: { source: 'fb', foo: 1 },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      success: false,
      error: {
        code: 'validation_error',
        message: 'Invalid lead',
        details: expect.arrayContaining([
          { field: 'phone', issue: 'invalid_phone' },
          { field: 'email', issue: 'invalid_format' },
          { field: 'utm', issue: 'unrecognized_keys' },
        ]),
      },
    });
    expect(await count('leads')).toBe(0);
  });

  it.each([
    ['unknown product', { product: 'nope' }, 'unknown_product'],
    ['unknown funnel', { funnel: 'nope' }, 'unknown_funnel'],
    // dtc-01 exists, but only for nutralean.
    ['funnel of another product', { product: 'glicofit', funnel: 'dtc-01' }, 'unknown_funnel'],
  ])('rejects %s', async (_label, override, code) => {
    const response = await postLead({ ...validLead, ...override });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe(code);
  });

  it('rejects an inactive product', async () => {
    await t.pool.query(`UPDATE products SET is_active = false WHERE slug = 'nutralean'`);

    const response = await postLead(validLead);

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('unknown_product');
  });
});

describe('POST /api/leads: transport errors', () => {
  it('rejects malformed JSON with 400', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/leads',
      headers: { 'content-type': 'application/json' },
      payload: '{"name": "Ana",',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_json');
  });

  it('rejects a body over 16 KB with 413', async () => {
    const response = await postLead({ ...validLead, campaign: 'x'.repeat(17 * 1024) });

    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('payload_too_large');
  });

  it('rejects a non-JSON content type with 415', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/leads',
      headers: { 'content-type': 'text/plain' },
      payload: 'name=Ana',
    });

    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe('unsupported_media_type');
  });
});
