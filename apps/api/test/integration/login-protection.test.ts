import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { DEMO_PASSWORD, seedDemo } from '../../src/db/seed.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { OPERATOR_A } from '../helpers/auth.js';
import { truncateAll } from '../helpers/db.js';

let t: TestApp;

function login(password: string, ip = '10.0.0.1') {
  return t.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: OPERATOR_A, password },
    remoteAddress: ip,
  });
}

async function lockState() {
  const { rows } = await t.pool.query<{ failed: number; locked: boolean }>(
    `SELECT failed_login_count AS failed, coalesce(locked_until > now(), false) AS locked
     FROM users WHERE email = $1`,
    [OPERATOR_A],
  );
  return rows[0]!;
}

beforeAll(async () => {
  // Real login limit (5/min per IP); each test uses its own IPs so they do not interfere.
  t = await createTestApp(5, { RATE_LIMIT_LOGIN_PER_MIN: '5' });
});
afterAll(() => t.close());
beforeEach(async () => {
  await truncateAll(t.pool);
  await seedDemo(createDb(t.pool));
});

describe('login rate limit (per IP)', () => {
  it('answers 429 from the 6th attempt in a minute, in the single error format', async () => {
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await login('wrong', '10.0.1.1')).statusCode);
    }
    const blocked = await login(DEMO_PASSWORD, '10.0.1.1');

    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('rate_limited');
    expect(blocked.headers['retry-after']).toBeDefined();
    // Another IP is not affected by this one's limit (other user: the 5 failures above also
    // locked operator.a, which is the per-account protection).
    const otherIp = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'operator.b@elevate.local', password: DEMO_PASSWORD },
      remoteAddress: '10.0.1.2',
    });
    expect(otherIp.statusCode).toBe(200);
  });
});

describe('account lockout (per user, across IPs)', () => {
  it('locks after 5 wrong passwords, even when they come from different IPs', async () => {
    for (let i = 0; i < 5; i += 1) {
      await login('wrong', `10.0.2.${i}`);
    }

    expect(await lockState()).toEqual({ failed: 0, locked: true });
    // Correct password while locked: same answer as a wrong one (no hint about the lock).
    const response = await login(DEMO_PASSWORD, '10.0.2.99');
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('invalid_credentials');
  });

  it('allows login again once locked_until has passed', async () => {
    await t.pool.query(
      `UPDATE users SET locked_until = now() - interval '1 second' WHERE email = $1`,
      [OPERATOR_A],
    );

    expect((await login(DEMO_PASSWORD, '10.0.3.1')).statusCode).toBe(200);
  });

  it('resets the failure counter on a successful login', async () => {
    await login('wrong', '10.0.4.1');
    await login('wrong', '10.0.4.2');
    expect((await lockState()).failed).toBe(2);

    await login(DEMO_PASSWORD, '10.0.4.3');

    expect(await lockState()).toEqual({ failed: 0, locked: false });
  });
});

describe('security headers', () => {
  it('sets helmet headers on API responses', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/health' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['strict-transport-security']).toBeDefined();
  });
});
