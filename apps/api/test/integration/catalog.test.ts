import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { seedDemo } from '../../src/db/seed.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { ADMIN, loginAs, OPERATOR_A } from '../helpers/auth.js';
import { truncateAll } from '../helpers/db.js';
import { insertLead } from '../helpers/leads.js';

let t: TestApp;

async function catalog(email: string) {
  const response = await t.app.inject({
    method: 'GET',
    url: '/api/catalog',
    headers: { cookie: await loginAs(t.app, email) },
  });
  expect(response.statusCode).toBe(200);
  return response;
}

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await truncateAll(t.pool);
  await seedDemo(createDb(t.pool));
  await insertLead(t.pool, {
    createdAt: '2026-10-15 10:00:00-03',
    callCenter: 'cc-a',
    source: 'facebook',
  });
  await insertLead(t.pool, {
    createdAt: '2026-10-15 11:00:00-03',
    callCenter: 'cc-b',
    source: 'tiktok',
  });
});

describe('GET /api/catalog', () => {
  it('gives the ADMIN every active product with funnels, call center, source and status', async () => {
    await t.pool.query(`UPDATE products SET is_active = false WHERE slug = 'sonoleve'`);

    const body = (await catalog(ADMIN)).json();

    expect(body.products).toEqual([
      {
        slug: 'glicofit',
        name: 'GlicoFit',
        funnels: [{ slug: 'vsl-01', name: 'GlicoFit vsl-01' }],
      },
      {
        slug: 'nutralean',
        name: 'NutraLean',
        funnels: [
          { slug: 'dtc-01', name: 'NutraLean dtc-01' },
          { slug: 'vsl-01', name: 'NutraLean vsl-01' },
          { slug: 'vsl-02', name: 'NutraLean vsl-02' },
        ],
      },
    ]);
    expect(body.call_centers.map((c: { slug: string }) => c.slug)).toEqual([
      'cc-a',
      'cc-b',
      'cc-c',
    ]);
    expect(body.sources).toEqual(['facebook', 'tiktok']);
    expect(body.statuses).toContain('sale');
  });

  it('limits call centers and sources to the OPERATOR scope', async () => {
    const response = await catalog(OPERATOR_A);
    const body = response.json();

    expect(body.call_centers).toEqual([{ id: 1, slug: 'cc-a', name: 'Call Center A' }]);
    expect(body.sources).toEqual(['facebook']);
    expect(response.body).not.toContain('secret');
  });
});
