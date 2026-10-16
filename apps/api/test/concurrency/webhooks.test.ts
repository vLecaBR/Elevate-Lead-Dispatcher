import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { seedDemo } from '../../src/db/seed.js';
import { reduceStatus, type StatusEvent } from '../../src/modules/status/reducer.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { truncateAll } from '../helpers/db.js';
import { sendWebhook } from '../helpers/webhook.js';

// Fewer connections than concurrent webhooks: transactions really queue on the lead lock.
const POOL_SIZE = 10;

let t: TestApp;

async function createLeadForCcA(email: string): Promise<{ id: string; createdAt: Date }> {
  // With 50/30/20 and fresh credits, every 10 leads A gets picks 1, 4, 5, 7, 10. Instead
  // of relying on that, create leads one by one and keep only those that went to cc-a.
  const response = await t.app.inject({
    method: 'POST',
    url: '/api/leads',
    payload: {
      name: 'Ana Souza',
      email,
      phone: '+5511987654321',
      product: 'nutralean',
      funnel: 'vsl-01',
      source: 'test',
    },
  });
  const id = response.json().lead_id as string;
  const { rows } = await t.pool.query<{ created_at: Date; slug: string }>(
    `SELECT l.created_at, c.slug FROM leads l JOIN call_centers c ON c.id = l.call_center_id
     WHERE l.id = $1`,
    [id],
  );
  if (rows[0]!.slug !== 'cc-a') {
    return createLeadForCcA(`next-${email}`);
  }
  return { id, createdAt: rows[0]!.created_at };
}

const at = (base: Date, seconds: number) => new Date(base.getTime() + seconds * 1000).toISOString();

beforeAll(async () => {
  t = await createTestApp(POOL_SIZE);
});
afterAll(() => t.close());
beforeEach(async () => {
  await truncateAll(t.pool);
  await seedDemo(createDb(t.pool));
});

describe('webhooks under concurrency', () => {
  it('records one event from 30 identical simultaneous deliveries', async () => {
    const lead = await createLeadForCcA('dup@example.com');
    const body = { lead_id: lead.id, status: 'contacted', event_ts: at(lead.createdAt, 10) };

    const responses = await Promise.all(
      Array.from({ length: 30 }, () => sendWebhook(t.app, { callCenter: 'cc-a', body })),
    );

    const results = responses.map((r) => r.json().result as string);
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    expect(results.filter((r) => r === 'applied')).toHaveLength(1);
    expect(results.filter((r) => r === 'duplicate')).toHaveLength(29);

    const { rows } = await t.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM lead_status_events WHERE lead_id = $1 AND source = 'webhook'`,
      [lead.id],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('ends every lead in the status the reducer gives for all of its events, whatever the arrival order', async () => {
    // By event time this is a valid path all the way to refund (12 steps); it is sent in a
    // scrambled order, all at once.
    const path = [
      'contacted',
      'no_answer',
      'contacted',
      'callback',
      'no_answer',
      'callback',
      'contacted',
      'no_answer',
      'callback',
      'qualified',
      'sale',
      'refund',
    ];
    const history = path
      .map((status, i): [string, number] => [status, (i + 1) * 5])
      .sort((a, b) => ((a[1] * 7) % 13) - ((b[1] * 7) % 13));
    // A lost update needs two transactions of the SAME lead to overlap, which is a matter of
    // timing: few leads with many events each, over several rounds, make a missing lock
    // fail this test reliably.
    const ROUNDS = 5;
    const LEADS_PER_ROUND = 2;
    const leads: Array<{ id: string; createdAt: Date }> = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const roundLeads: Array<{ id: string; createdAt: Date }> = [];
      for (let i = 0; i < LEADS_PER_ROUND; i += 1) {
        roundLeads.push(await createLeadForCcA(`r${round}-lead${i}@example.com`));
      }

      // 2 leads x 12 statuses = 24 webhooks at once, interleaved across leads.
      const responses = await Promise.all(
        history.flatMap(([status, seconds]) =>
          roundLeads.map((lead) =>
            sendWebhook(t.app, {
              callCenter: 'cc-a',
              body: { lead_id: lead.id, status, event_ts: at(lead.createdAt, seconds) },
            }),
          ),
        ),
      );
      expect(responses.every((r) => r.statusCode === 200)).toBe(true);
      leads.push(...roundLeads);
    }

    for (const lead of leads) {
      const { rows: events } = await t.pool.query<{
        id: string;
        status: StatusEvent['status'];
        event_ts: Date;
      }>('SELECT id, status, event_ts FROM lead_status_events WHERE lead_id = $1', [lead.id]);
      const { rows: projection } = await t.pool.query<{ status: string }>(
        'SELECT status FROM leads WHERE id = $1',
        [lead.id],
      );
      const replayed = reduceStatus(
        events.map((e) => ({ id: Number(e.id), status: e.status, eventTs: e.event_ts })),
      );

      expect(events).toHaveLength(1 + path.length); // new + every webhook
      expect(projection[0]!.status).toBe(replayed.status);
      expect(projection[0]!.status).toBe('refund');
    }
  });
});
