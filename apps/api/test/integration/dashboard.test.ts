import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { seedDemo } from '../../src/db/seed.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { ADMIN, loginAs, OPERATOR_A } from '../helpers/auth.js';
import { truncateAll } from '../helpers/db.js';
import { insertLead } from '../helpers/leads.js';

let t: TestApp;

// Local midnight of "today" in São Paulo, computed by Postgres (the same clock the metric
// uses), shifted by some minutes.
async function aroundLocalMidnight(minutes: number): Promise<string> {
  const { rows } = await t.pool.query<{ ts: string }>(
    `SELECT ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')
             + make_interval(mins => $1))::text AS ts`,
    [minutes],
  );
  return rows[0]!.ts;
}

function metrics(cookie: string) {
  return t.app.inject({ method: 'GET', url: '/api/dashboard/metrics', headers: { cookie } });
}

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await truncateAll(t.pool);
  await seedDemo(createDb(t.pool));
});

describe('GET /api/dashboard/metrics', () => {
  it('counts totals, today in the business timezone, distribution and sales', async () => {
    const justAfterMidnight = await aroundLocalMidnight(1);
    const justBeforeMidnight = await aroundLocalMidnight(-1);
    await insertLead(t.pool, { createdAt: justAfterMidnight, status: 'sale' });
    await insertLead(t.pool, { createdAt: justAfterMidnight, callCenter: null });
    await insertLead(t.pool, { createdAt: justBeforeMidnight, status: 'sale' });
    await insertLead(t.pool, { createdAt: justBeforeMidnight, status: 'refund' });

    const response = await metrics(await loginAs(t.app, ADMIN));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      total: 4,
      today: 2, // 23:59 of yesterday in São Paulo does not count, even if it is "today" in UTC
      distributed: 3,
      pending: 1,
      sales: 2, // the refunded one is not a sale anymore
      conversion_rate: 0.5,
      by_status: {
        new: 1,
        contacted: 0,
        no_answer: 0,
        callback: 0,
        qualified: 0,
        sale: 2,
        refund: 1,
        invalid: 0,
      },
    });
  });

  it('answers zeros (not a division by zero) when there are no leads', async () => {
    const body = (await metrics(await loginAs(t.app, ADMIN))).json();

    expect(body).toMatchObject({ total: 0, today: 0, sales: 0, conversion_rate: 0 });
  });

  it('is for ADMIN only', async () => {
    expect((await metrics(await loginAs(t.app, OPERATOR_A))).statusCode).toBe(403);
  });
});
