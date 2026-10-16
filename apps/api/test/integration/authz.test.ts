import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { parseEnv } from '../../src/config/env.js';
import { createDb, createPool } from '../../src/db/client.js';
import { seedDemo } from '../../src/db/seed.js';
import { ADMIN, loginAs, OPERATOR_A, OPERATOR_B } from '../helpers/auth.js';
import { requireTestDatabaseUrl, truncateAll } from '../helpers/db.js';

// PLAN.md §10: the only routes reachable without a session. Anything else is protected,
// including routes added in the future (they are discovered below, not listed by hand).
const PUBLIC_ROUTES = [
  'GET /health',
  'GET /ready',
  'POST /api/auth/login',
  'POST /api/leads',
  'POST /api/webhooks/callcenter',
];

interface RegisteredRoute {
  method: string;
  url: string;
  public: boolean;
}

const env = parseEnv({
  DATABASE_URL: requireTestDatabaseUrl(),
  LOG_LEVEL: 'silent',
  RATE_LIMIT_GLOBAL_PER_MIN: '1000000',
  RATE_LIMIT_LOGIN_PER_MIN: '1000000',
  RATE_LIMIT_LEADS_PER_MIN: '1000000',
});
const pool = createPool(env.DATABASE_URL, { max: 5, onIdleClientError: () => {} });
const routes: RegisteredRoute[] = [];
let app: FastifyInstance;
let leadOfA: string;

beforeAll(async () => {
  app = buildApp({ env, pool });
  // Records every route the real app registers, whatever module it comes from.
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method !== 'HEAD') {
        routes.push({ method, url: route.url, public: route.config?.public === true });
      }
    }
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await truncateAll(pool);
  await seedDemo(createDb(pool));
  const created = await app.inject({
    method: 'POST',
    url: '/api/leads',
    payload: {
      name: 'Ana Souza',
      email: 'ana@example.com',
      phone: '+5511987654321',
      product: 'nutralean',
      funnel: 'vsl-01',
      source: 'facebook',
    },
  });
  leadOfA = created.json().lead_id; // first SWRR pick: cc-a
});

describe('default-deny route allowlist', () => {
  it('discovers the routes of the app', () => {
    expect(routes.length).toBeGreaterThan(PUBLIC_ROUTES.length);
  });

  it('has exactly the allowlist as public routes', () => {
    const publicRoutes = routes.filter((r) => r.public).map((r) => `${r.method} ${r.url}`);

    expect(publicRoutes.sort()).toEqual([...PUBLIC_ROUTES].sort());
  });

  it('answers 401 on every other route when there is no session', async () => {
    const protectedRoutes = routes.filter((r) => !r.public);

    for (const route of protectedRoutes) {
      const url = route.url.replace(':id', '01900000-0000-7000-8000-000000000000');
      const response = await app.inject({
        method: route.method as 'GET' | 'POST',
        url,
        payload: route.method === 'GET' ? undefined : {},
      });

      expect({ route: `${route.method} ${route.url}`, status: response.statusCode }).toEqual({
        route: `${route.method} ${route.url}`,
        status: 401,
      });
    }
  });

  it('answers 401 for a forged or tampered session cookie', async () => {
    const cookie = await loginAs(app, OPERATOR_A);

    for (const forged of ['sid=forged', `${cookie}x`]) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: forged },
      });
      expect(response.statusCode).toBe(401);
    }
  });
});

describe('role guard', () => {
  it('answers 403 to an OPERATOR on an admin route and lets an ADMIN through', async () => {
    const url = '/api/admin/dispatcher/redispatch-pending';
    const asOperator = await app.inject({
      method: 'POST',
      url,
      headers: { cookie: await loginAs(app, OPERATOR_A) },
    });
    const asAdmin = await app.inject({
      method: 'POST',
      url,
      headers: { cookie: await loginAs(app, ADMIN) },
    });

    expect(asOperator.statusCode).toBe(403);
    expect(asOperator.json().error.code).toBe('forbidden');
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.json()).toEqual({ success: true, distributed: 0, remaining: 0 });
  });
});

describe('call center scope (from the session, enforced in the repository)', () => {
  it('lets an OPERATOR read and change leads of their own call center', async () => {
    const cookie = await loginAs(app, OPERATOR_A);

    const read = await app.inject({
      method: 'GET',
      url: `/api/leads/${leadOfA}`,
      headers: { cookie },
    });
    const change = await app.inject({
      method: 'POST',
      url: `/api/leads/${leadOfA}/status`,
      headers: { cookie },
      payload: { status: 'contacted' },
    });

    expect(read.statusCode).toBe(200);
    expect(change.statusCode).toBe(200);
  });

  it('answers 404 (not 403) to an OPERATOR of another call center, for reads and writes', async () => {
    const cookie = await loginAs(app, OPERATOR_B);

    const read = await app.inject({
      method: 'GET',
      url: `/api/leads/${leadOfA}`,
      headers: { cookie },
    });
    const change = await app.inject({
      method: 'POST',
      url: `/api/leads/${leadOfA}/status`,
      headers: { cookie },
      payload: { status: 'sale' },
    });

    // Same answer as a lead that does not exist: no way to probe other call centers.
    expect(read.statusCode).toBe(404);
    expect(change.statusCode).toBe(404);
    const { rows } = await pool.query('SELECT status FROM leads WHERE id = $1', [leadOfA]);
    expect(rows[0].status).toBe('new');
  });

  it('cannot be widened by the client: query parameters do not change the scope', async () => {
    const cookie = await loginAs(app, OPERATOR_B);

    const response = await app.inject({
      method: 'GET',
      url: `/api/leads/${leadOfA}?call_center=1&call_center_id=1`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('lets an ADMIN read any lead', async () => {
    const cookie = await loginAs(app, ADMIN);

    const response = await app.inject({
      method: 'GET',
      url: `/api/leads/${leadOfA}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('Origin check on cookie-authenticated writes (CSRF defense in depth)', () => {
  it('refuses a write whose Origin is not an allowed front end', async () => {
    const cookie = await loginAs(app, OPERATOR_A);

    const response = await app.inject({
      method: 'POST',
      url: `/api/leads/${leadOfA}/status`,
      headers: { cookie, origin: 'https://evil.example' },
      payload: { status: 'contacted' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('forbidden_origin');
  });

  it('accepts the configured front-end origin', async () => {
    const cookie = await loginAs(app, OPERATOR_A);

    const response = await app.inject({
      method: 'POST',
      url: `/api/leads/${leadOfA}/status`,
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { status: 'contacted' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('refuses a login posted from another site', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { email: ADMIN, password: 'anything' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('does not affect the public intake, which landing pages call from other domains', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/leads',
      headers: { origin: 'https://landing.example' },
      payload: {
        name: 'Bia',
        email: 'bia@example.com',
        phone: '+5511987654322',
        product: 'nutralean',
        funnel: 'vsl-01',
        source: 'google',
      },
    });

    expect(response.statusCode).toBe(201);
  });
});
