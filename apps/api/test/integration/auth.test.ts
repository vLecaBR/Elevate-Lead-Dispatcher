import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { DEMO_PASSWORD, seedDemo } from '../../src/db/seed.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { ADMIN, loginAs, OPERATOR_A } from '../helpers/auth.js';
import { truncateAll } from '../helpers/db.js';

let t: TestApp;

function login(email: string, password: string) {
  return t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
}

function me(cookie?: string) {
  return t.app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: cookie ? { cookie } : {},
  });
}

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await truncateAll(t.pool);
  await seedDemo(createDb(t.pool));
});

describe('POST /api/auth/login', () => {
  it('opens a session with a hardened cookie and returns the user without secrets', async () => {
    const response = await login(' Operator.A@Elevate.local ', DEMO_PASSWORD);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      user: {
        id: expect.any(String),
        email: 'operator.a@elevate.local',
        role: 'OPERATOR',
        call_center_id: 1,
      },
    });
    expect(response.body).not.toContain('argon2');

    const sid = response.cookies.find((c) => c.name === 'sid');
    expect(sid).toMatchObject({
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      secure: true,
      maxAge: 8 * 3600,
    });
    expect(sid!.value).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url

    // Only the hash of the token is stored.
    const { rows } = await t.pool.query<{ token_hash: string }>('SELECT token_hash FROM sessions');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toBe(sid!.value);
  });

  it('answers wrong password, unknown e-mail and inactive user identically', async () => {
    await t.pool.query(`UPDATE users SET is_active = false WHERE email = $1`, [OPERATOR_A]);

    const responses = await Promise.all([
      login(ADMIN, 'wrong-password'),
      login('nobody@elevate.local', DEMO_PASSWORD),
      login(OPERATOR_A, DEMO_PASSWORD),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        success: false,
        error: { code: 'invalid_credentials', message: 'Invalid e-mail or password' },
      });
      expect(response.cookies).toHaveLength(0);
    }
  });

  it('validates the body', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN },
    });

    expect(response.statusCode).toBe(422);
  });
});

describe('GET /api/auth/me and logout', () => {
  it('returns the session user', async () => {
    const cookie = await loginAs(t.app, ADMIN);

    const response = await me(cookie);

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toEqual({
      id: expect.any(String),
      email: ADMIN,
      role: 'ADMIN',
      call_center_id: null,
    });
  });

  it('is 401 without a session, with an unknown token and with an expired session', async () => {
    const cookie = await loginAs(t.app, ADMIN);
    await t.pool.query(`UPDATE sessions SET expires_at = now() - interval '1 second'`);

    for (const attempt of [undefined, 'sid=not-a-real-token', cookie]) {
      expect((await me(attempt)).statusCode).toBe(401);
    }
  });

  it('revokes access at once when the user is deactivated', async () => {
    const cookie = await loginAs(t.app, OPERATOR_A);
    await t.pool.query(`UPDATE users SET is_active = false WHERE email = $1`, [OPERATOR_A]);

    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('logout deletes the session server-side and clears the cookie', async () => {
    const cookie = await loginAs(t.app, ADMIN);

    const response = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.cookies.find((c) => c.name === 'sid')?.value).toBe('');
    // The old cookie is useless even if someone kept a copy.
    expect((await me(cookie)).statusCode).toBe(401);
    const { rows } = await t.pool.query('SELECT 1 FROM sessions');
    expect(rows).toHaveLength(0);
  });
});
