import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { seedDemo } from '../../src/db/seed.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { ADMIN, loginAs, OPERATOR_A } from '../helpers/auth.js';
import { truncateAll } from '../helpers/db.js';

let t: TestApp;
let admin: string;
let n = 0;

async function postLeads(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    n += 1;
    await t.app.inject({
      method: 'POST',
      url: '/api/leads',
      payload: {
        name: 'Lead',
        email: `lead${n}@example.com`,
        phone: '+5511987654321',
        product: 'nutralean',
        funnel: 'vsl-01',
        source: 'test',
      },
    });
  }
}

function summary(cookie = admin) {
  return t.app.inject({ method: 'GET', url: '/api/admin/dispatcher', headers: { cookie } });
}

function patch(id: number | string, body: object, cookie = admin) {
  return t.app.inject({
    method: 'PATCH',
    url: `/api/admin/call-centers/${id}`,
    headers: { cookie },
    payload: body,
  });
}

async function credits(): Promise<number[]> {
  const { rows } = await t.pool.query<{ credit: string }>(
    'SELECT dispatch_credit AS credit FROM call_centers ORDER BY id',
  );
  return rows.map((r) => Number(r.credit));
}

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await truncateAll(t.pool);
  await seedDemo(createDb(t.pool));
  admin = await loginAs(t.app, ADMIN);
});

describe('GET /api/admin/dispatcher', () => {
  it('shows target vs actual split and the pending queue, without secrets', async () => {
    await postLeads(10);

    const response = await summary();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      pending: 0,
      call_centers: [
        {
          id: 1,
          slug: 'cc-a',
          name: 'Call Center A',
          weight: 50,
          is_active: true,
          target_pct: 50,
          distributed: 5,
          actual_pct: 50,
        },
        {
          id: 2,
          slug: 'cc-b',
          name: 'Call Center B',
          weight: 30,
          is_active: true,
          target_pct: 30,
          distributed: 3,
          actual_pct: 30,
        },
        {
          id: 3,
          slug: 'cc-c',
          name: 'Call Center C',
          weight: 20,
          is_active: true,
          target_pct: 20,
          distributed: 2,
          actual_pct: 20,
        },
      ],
    });
    expect(response.body).not.toContain('secret');
  });

  it('is for ADMIN only', async () => {
    expect((await summary(await loginAs(t.app, OPERATOR_A))).statusCode).toBe(403);
  });
});

describe('PATCH /api/admin/call-centers/:id', () => {
  it('changes the weight and resets every credit in the same transaction', async () => {
    await postLeads(3); // A, B, C: credits are no longer zero
    expect(await credits()).not.toEqual([0, 0, 0]);

    const response = await patch(1, { weight: 70 });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      call_center: { id: 1, slug: 'cc-a', name: 'Call Center A', weight: 70, is_active: true },
    });
    expect(await credits()).toEqual([0, 0, 0]);
    expect(response.body).not.toContain('secret');
  });

  it('takes a deactivated call center out of the rotation for the next leads', async () => {
    await patch(1, { is_active: false });

    await postLeads(10);

    const centers = (await summary()).json().call_centers;
    expect(centers.map((c: { distributed: number }) => c.distributed)).toEqual([0, 6, 4]); // 30:20
    expect(centers[0]).toMatchObject({ is_active: false, target_pct: 0 });
    expect(centers[1].target_pct).toBe(60);
  });

  it('takes a weight-0 call center out of the rotation', async () => {
    await patch(3, { weight: 0 });

    await postLeads(8);

    expect(
      (await summary()).json().call_centers.map((c: { distributed: number }) => c.distributed),
    ).toEqual([5, 3, 0]);
  });

  it.each([
    ['empty body', {}],
    ['negative weight', { weight: -1 }],
    ['weight as string', { weight: '10' }],
    ['unknown field', { weight: 10, webhook_secret: 'x' }],
  ])('rejects %s with 422', async (_label, body) => {
    expect((await patch(1, body)).statusCode).toBe(422);
  });

  it('answers 404 for an unknown call center', async () => {
    expect((await patch(999, { weight: 10 })).statusCode).toBe(404);
    expect((await patch('abc', { weight: 10 })).statusCode).toBe(404);
  });

  it('is for ADMIN only', async () => {
    expect((await patch(1, { weight: 10 }, await loginAs(t.app, OPERATOR_A))).statusCode).toBe(403);
  });
});
