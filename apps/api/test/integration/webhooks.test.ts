import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { seedDemo } from '../../src/db/seed.js';
import { signWebhook } from '../../src/modules/webhooks/signature.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { truncateAll } from '../helpers/db.js';
import { sendWebhook } from '../helpers/webhook.js';

let t: TestApp;
let leadId: string; // dispatched to cc-a (first SWRR pick)
let leadCreatedAt: Date;

async function createLead(email: string): Promise<string> {
  const response = await t.app.inject({
    method: 'POST',
    url: '/api/leads',
    payload: {
      name: 'Ana Souza',
      email,
      phone: '+5511987654321',
      product: 'nutralean',
      funnel: 'vsl-01',
      source: 'facebook',
    },
  });
  return response.json().lead_id;
}

async function leadState(id: string) {
  const { rows } = await t.pool.query<{ status: string; history: string[] }>(
    `SELECT l.status,
            array_agg(e.status::text ORDER BY e.event_ts, e.id) AS history
     FROM leads l JOIN lead_status_events e ON e.lead_id = l.id
     WHERE l.id = $1 GROUP BY l.status`,
    [id],
  );
  return rows[0]!;
}

// Event times are seconds after the lead was created, as a real call center would report.
const event = (status: string, seconds: number, extra: object = {}) => ({
  lead_id: leadId,
  status,
  timestamp: new Date(leadCreatedAt.getTime() + seconds * 1000).toISOString(),
  ...extra,
});

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await truncateAll(t.pool);
  await seedDemo(createDb(t.pool));
  leadId = await createLead('ana@example.com');
  const { rows } = await t.pool.query<{ created_at: Date }>(
    'SELECT created_at FROM leads WHERE id = $1',
    [leadId],
  );
  leadCreatedAt = rows[0]!.created_at;
});

describe('webhook authentication (401, always the same body)', () => {
  const generic401 = {
    success: false,
    error: { code: 'invalid_signature', message: 'Invalid webhook signature' },
  };

  it.each([
    ['wrong secret', { secret: 'not-the-secret' }],
    ['unknown call center', { callCenter: 'cc-x' }],
    ['expired timestamp', { timestamp: Math.floor(Date.now() / 1000) - 301 }],
    ['missing signature', { headers: { 'x-elevate-signature': '' } }],
    ['missing call center id', { headers: { 'x-callcenter-id': '' } }],
  ])('rejects %s', async (_label, options) => {
    const response = await sendWebhook(t.app, {
      callCenter: 'cc-a',
      body: event('contacted', 1),
      ...options,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual(generic401);
  });

  it('rejects a body changed after it was signed', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signed = JSON.stringify(event('contacted', 1));
    const tampered = JSON.stringify(event('sale', 1));

    const response = await t.app.inject({
      method: 'POST',
      url: '/api/webhooks/callcenter',
      headers: {
        'content-type': 'application/json',
        'x-callcenter-id': 'cc-a',
        'x-elevate-timestamp': timestamp,
        'x-elevate-signature': signWebhook(
          'dev-webhook-secret-cc-a',
          timestamp,
          Buffer.from(signed),
        ),
      },
      payload: tampered,
    });

    expect(response.statusCode).toBe(401);
    expect((await leadState(leadId)).status).toBe('new');
  });
});

describe('webhook authorization and validation', () => {
  it('answers 404 for a lead that does not exist', async () => {
    const response = await sendWebhook(t.app, {
      callCenter: 'cc-a',
      body: event('contacted', 1, { lead_id: '01900000-0000-7000-8000-000000000000' }),
    });

    expect(response.statusCode).toBe(404);
  });

  it('answers 404 when the lead belongs to another call center (no cross-call-center writes)', async () => {
    const response = await sendWebhook(t.app, { callCenter: 'cc-b', body: event('sale', 1) });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('lead_not_found');
    expect((await leadState(leadId)).history).toEqual(['new']);
  });

  it.each([
    ['unknown status', { status: 'won' }, 'status'],
    ['status new', { status: 'new' }, 'status'],
    ['unknown field', { color: 'blue' }, ''],
    ['bad timestamp', { timestamp: 'yesterday' }, 'timestamp'],
    ['bad lead id', { lead_id: '123' }, 'lead_id'],
  ])('answers 422 for %s', async (_label, override, field) => {
    const response = await sendWebhook(t.app, {
      callCenter: 'cc-a',
      body: { ...event('contacted', 1), ...override },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.details.map((d: { field: string }) => d.field)).toContain(field);
  });

  it('answers 422 for a timestamp more than 5 minutes in the future', async () => {
    const response = await sendWebhook(t.app, {
      callCenter: 'cc-a',
      body: event('contacted', 10 * 60),
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.details).toEqual([{ field: 'timestamp', issue: 'in_future' }]);
  });

  it('answers 400 for a validly signed body that is not JSON', async () => {
    const response = await sendWebhook(t.app, { callCenter: 'cc-a', body: '{"lead_id":' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_json');
  });
});

describe('webhook processing', () => {
  it('accepts the exact payload shape of the challenge example (§14)', async () => {
    const response = await sendWebhook(t.app, {
      callCenter: 'cc-a',
      body: {
        lead_id: leadId,
        external_id: 'abc123',
        status: 'contacted',
        timestamp: new Date(leadCreatedAt.getTime() + 10_000).toISOString().replace('.000Z', 'Z'),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, result: 'applied' });
  });

  it('applies a valid status change', async () => {
    const response = await sendWebhook(t.app, { callCenter: 'cc-a', body: event('contacted', 1) });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, result: 'applied' });
    expect(await leadState(leadId)).toEqual({ status: 'contacted', history: ['new', 'contacted'] });
  });

  it('answers a duplicate delivery with 200 duplicate and records nothing new', async () => {
    const body = event('contacted', 1, { external_id: 'crm-1' });
    await sendWebhook(t.app, { callCenter: 'cc-a', body });

    // Retry: same event, re-signed with a fresh timestamp, as a provider would.
    const retry = await sendWebhook(t.app, { callCenter: 'cc-a', body });

    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ success: true, result: 'duplicate' });
    expect((await leadState(leadId)).history).toEqual(['new', 'contacted']);
  });

  it('keeps sale when contacted arrives late, with both in the history', async () => {
    await sendWebhook(t.app, { callCenter: 'cc-a', body: event('sale', 20) });
    const late = await sendWebhook(t.app, { callCenter: 'cc-a', body: event('contacted', 10) });

    expect(late.json().result).toBe('ignored');
    expect(await leadState(leadId)).toEqual({
      status: 'sale',
      history: ['new', 'contacted', 'sale'],
    });
  });

  it('applies a refund that arrived before its sale once the sale shows up', async () => {
    const early = await sendWebhook(t.app, { callCenter: 'cc-a', body: event('refund', 30) });
    expect(early.json().result).toBe('ignored');
    expect((await leadState(leadId)).status).toBe('new');

    const sale = await sendWebhook(t.app, { callCenter: 'cc-a', body: event('sale', 20) });

    expect(sale.json().result).toBe('applied');
    expect((await leadState(leadId)).status).toBe('refund');
  });

  it('records the first external_id on the distribution and never overwrites it', async () => {
    await sendWebhook(t.app, {
      callCenter: 'cc-a',
      body: event('contacted', 10, { external_id: 'crm-1' }),
    });
    await sendWebhook(t.app, {
      callCenter: 'cc-a',
      body: event('qualified', 20, { external_id: 'crm-2' }),
    });

    const { rows } = await t.pool.query(
      `SELECT d.external_id AS distribution, array_agg(e.external_id ORDER BY e.event_ts) AS events
       FROM distributions d JOIN lead_status_events e ON e.lead_id = d.lead_id AND e.source = 'webhook'
       WHERE d.lead_id = $1 GROUP BY d.external_id`,
      [leadId],
    );
    expect(rows[0]).toEqual({ distribution: 'crm-1', events: ['crm-1', 'crm-2'] });
  });
});
