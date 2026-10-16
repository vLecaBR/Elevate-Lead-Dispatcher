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

describe('client IP behind a trusted edge proxy', () => {
  const PROXY_IP = '10.9.9.9';

  async function attemptsUntilBlocked(
    app: TestApp['app'],
    from: { remoteAddress: string; forwardedFor: string },
  ): Promise<number[]> {
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'nobody@elevate.local', password: 'x' },
        remoteAddress: from.remoteAddress,
        headers: { 'x-forwarded-for': from.forwardedFor },
      });
      statuses.push(response.statusCode);
    }
    return statuses;
  }

  it('limits each real client separately when the request comes through the trusted proxy', async () => {
    const proxied = await createTestApp(2, {
      RATE_LIMIT_LOGIN_PER_MIN: '5',
      TRUST_PROXY: PROXY_IP,
    });
    try {
      const first = await attemptsUntilBlocked(proxied.app, {
        remoteAddress: PROXY_IP,
        forwardedFor: '203.0.113.1',
      });
      const second = await attemptsUntilBlocked(proxied.app, {
        remoteAddress: PROXY_IP,
        forwardedFor: '203.0.113.2',
      });

      // Without trusting the proxy, everyone behind it would share one bucket.
      expect(first.at(-1)).toBe(429);
      expect(second.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    } finally {
      await proxied.close();
    }
  });

  it('ignores X-Forwarded-For from anyone who is not the trusted proxy (no spoofing)', async () => {
    const proxied = await createTestApp(2, {
      RATE_LIMIT_LOGIN_PER_MIN: '5',
      TRUST_PROXY: PROXY_IP,
    });
    try {
      // A direct caller rotating fake X-Forwarded-For values is still one client.
      const statuses = [];
      for (let i = 0; i < 6; i += 1) {
        const response = await proxied.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'nobody@elevate.local', password: 'x' },
          remoteAddress: '198.51.100.7',
          headers: { 'x-forwarded-for': `203.0.113.${i}` },
        });
        statuses.push(response.statusCode);
      }
      expect(statuses.at(-1)).toBe(429);
    } finally {
      await proxied.close();
    }
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
