import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { seedDemo } from '../../src/db/seed.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { ADMIN, loginAs, OPERATOR_A } from '../helpers/auth.js';
import { truncateAll } from '../helpers/db.js';

let t: TestApp;
let leadId: string; // first lead: dispatched to cc-a
let operatorA: string;

function detail(cookie: string, id = leadId) {
  return t.app.inject({ method: 'GET', url: `/api/leads/${id}`, headers: { cookie } });
}

function changeStatus(cookie: string, body: object, id = leadId) {
  return t.app.inject({
    method: 'POST',
    url: `/api/leads/${id}/status`,
    headers: { cookie },
    payload: body,
  });
}

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await truncateAll(t.pool);
  await seedDemo(createDb(t.pool));
  const created = await t.app.inject({
    method: 'POST',
    url: '/api/leads',
    payload: {
      name: 'Ana Souza',
      email: 'ana@example.com',
      phone: '+5511987654321',
      product: 'nutralean',
      funnel: 'vsl-01',
      source: 'facebook',
      affiliate_id: 'aff-1',
      utm: { source: 'fb' },
    },
  });
  leadId = created.json().lead_id;
  operatorA = await loginAs(t.app, OPERATOR_A);
});

describe('GET /api/leads/:id', () => {
  it('returns the lead, its distribution, history and the statuses that may come next', async () => {
    const response = await detail(operatorA);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lead).toMatchObject({
      id: leadId,
      name: 'Ana Souza',
      email: 'ana@example.com',
      phone: '+5511987654321',
      status: 'new',
      product: { slug: 'nutralean', name: 'NutraLean' },
      funnel: { slug: 'vsl-01' },
      affiliate_code: 'aff-1',
      utm: { source: 'fb', medium: null },
      call_center: { id: 1, slug: 'cc-a', name: 'Call Center A' },
      external_id: null,
    });
    expect(body.history).toEqual([expect.objectContaining({ status: 'new', source: 'system' })]);
    expect(body.allowed_next).toEqual([
      'contacted',
      'no_answer',
      'callback',
      'qualified',
      'sale',
      'invalid',
    ]);
    // Internal columns never leave the API.
    for (const internal of ['dedupe_key', 'request_hash', 'dedupeKey', 'webhook_secret']) {
      expect(response.body).not.toContain(internal);
    }
  });

  it('answers 404 for a malformed id instead of a validation error', async () => {
    expect((await detail(operatorA, 'not-a-uuid')).statusCode).toBe(404);
  });
});

describe('POST /api/leads/:id/status', () => {
  it('applies a valid manual change and records who made it', async () => {
    const response = await changeStatus(operatorA, { status: 'contacted', note: 'Ligou de volta' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, status: 'contacted' });

    const { rows } = await t.pool.query(
      `SELECT e.status, e.source, e.note, u.email AS actor
       FROM lead_status_events e JOIN users u ON u.id = e.actor_user_id
       WHERE e.lead_id = $1`,
      [leadId],
    );
    expect(rows).toEqual([
      { status: 'contacted', source: 'operator', note: 'Ligou de volta', actor: OPERATOR_A },
    ]);
    expect((await detail(operatorA)).json().allowed_next).toEqual([
      'no_answer',
      'callback',
      'qualified',
      'sale',
      'invalid',
    ]);
  });

  it('answers 409 for a transition the state machine does not allow, and changes nothing', async () => {
    await changeStatus(operatorA, { status: 'sale' });

    const response = await changeStatus(operatorA, { status: 'contacted' });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toEqual({
      code: 'invalid_transition',
      message: 'Cannot change status from sale to contacted',
      details: [{ field: 'status', issue: 'invalid_transition' }],
    });
    expect((await detail(operatorA)).json().lead.status).toBe('sale');
  });

  it('validates the body (unknown status, extra fields)', async () => {
    expect((await changeStatus(operatorA, { status: 'won' })).statusCode).toBe(422);
    expect((await changeStatus(operatorA, { status: 'sale', extra: 1 })).statusCode).toBe(422);
  });

  it('lets an ADMIN change any lead', async () => {
    const admin = await loginAs(t.app, ADMIN);

    expect((await changeStatus(admin, { status: 'invalid' })).statusCode).toBe(200);
  });
});
