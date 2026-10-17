import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { seedDemo } from '../../src/db/seed.js';
import { reduceStatus } from '../../src/modules/status/reducer.js';
import type { LeadStatus } from '../../src/modules/status/state-machine.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { ADMIN, loginAs, OPERATOR_A } from '../helpers/auth.js';
import { truncateAll } from '../helpers/db.js';
import { sendWebhook } from '../helpers/webhook.js';

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

  // Regression (independent review, B4): the call center clock may run a little ahead
  // (up to 5 min is accepted). A manual change stamped "now" can then sort BEFORE that
  // event, and the reducer keeps the call center's status: the API used to answer 200
  // with a different status than the one requested. Now it is a 409 and nothing is stored.
  it('answers 409 when a later call center event overrides the manual change', async () => {
    const ahead = new Date(Date.now() + 3 * 60_000).toISOString();
    await sendWebhook(t.app, {
      callCenter: 'cc-a',
      body: { lead_id: leadId, status: 'contacted', timestamp: ahead },
    });

    const response = await changeStatus(operatorA, { status: 'no_answer' });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('status_superseded');
    const { rows } = await t.pool.query(
      `SELECT count(*)::int AS n FROM lead_status_events WHERE lead_id = $1 AND source = 'operator'`,
      [leadId],
    );
    expect(rows[0].n).toBe(0); // rolled back
    expect((await detail(operatorA)).json().lead.status).toBe('contacted');
  });
});

describe('manual change racing a webhook on the same lead', () => {
  // Both paths take the lead's row lock and replay the whole log, so whatever the
  // interleaving, the stored status is what the reducer gives for the stored events.
  it('always ends in the reducer result of the stored events', async () => {
    const created = await t.pool.query<{ created_at: Date }>(
      'SELECT created_at FROM leads WHERE id = $1',
      [leadId],
    );
    const base = created.rows[0]!.created_at.getTime();

    const results = await Promise.all([
      changeStatus(operatorA, { status: 'contacted' }),
      sendWebhook(t.app, {
        callCenter: 'cc-a',
        body: {
          lead_id: leadId,
          status: 'no_answer',
          timestamp: new Date(base + 1_000).toISOString(),
        },
      }),
      sendWebhook(t.app, {
        callCenter: 'cc-a',
        body: {
          lead_id: leadId,
          status: 'callback',
          timestamp: new Date(base + 2_000).toISOString(),
        },
      }),
    ]);
    expect(results.every((r) => [200, 409].includes(r.statusCode))).toBe(true);

    const { rows: events } = await t.pool.query<{ id: string; status: LeadStatus; event_ts: Date }>(
      'SELECT id, status, event_ts FROM lead_status_events WHERE lead_id = $1',
      [leadId],
    );
    const expected = reduceStatus(
      events.map((e) => ({ id: Number(e.id), status: e.status, eventTs: e.event_ts })),
    ).status;
    expect((await detail(operatorA)).json().lead.status).toBe(expected);
  });
});
