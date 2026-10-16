import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { parseEnv } from '../../src/config/env.js';
import { createPool } from '../../src/db/client.js';
import { AppError } from '../../src/shared/errors.js';
import { requireTestDatabaseUrl } from '../helpers/db.js';

const env = parseEnv({ DATABASE_URL: requireTestDatabaseUrl(), LOG_LEVEL: 'silent' });
// One connection and a short wait, so the pool-exhaustion case is quick to reproduce.
const pool = createPool(env.DATABASE_URL, {
  max: 1,
  connectionTimeoutMs: 100,
  onIdleClientError: () => {},
});
let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp({ env, pool });
  // Test-only routes that fail on purpose.
  app.get('/test/app-error', async () => {
    throw new AppError(409, 'invalid_transition', 'Cannot go from sale to new', [
      { field: 'status', issue: 'invalid_transition' },
    ]);
  });
  app.get('/test/crash', async () => {
    throw new Error('connection to 10.0.0.5 failed: password authentication failed');
  });
  app.get('/test/needs-db', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('central error handler', () => {
  it('turns an AppError into the single error format', async () => {
    const response = await app.inject({ method: 'GET', url: '/test/app-error' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      success: false,
      error: {
        code: 'invalid_transition',
        message: 'Cannot go from sale to new',
        details: [{ field: 'status', issue: 'invalid_transition' }],
      },
    });
  });

  it('hides internals of unexpected errors', async () => {
    const response = await app.inject({ method: 'GET', url: '/test/crash' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      success: false,
      error: { code: 'internal_error', message: 'Internal server error' },
    });
    expect(response.body).not.toContain('10.0.0.5');
  });

  // Regression: under a 1000-lead burst, requests that waited longer than the pool's
  // connection timeout were answered 500 internal_error instead of an overload signal.
  it('answers 503 with Retry-After when no database connection frees up in time', async () => {
    const busy = await pool.connect(); // the only connection, held by "someone else"
    try {
      const response = await app.inject({ method: 'GET', url: '/test/needs-db' });

      expect(response.statusCode).toBe(503);
      expect(response.headers['retry-after']).toBe('1');
      expect(response.json()).toEqual({
        success: false,
        error: { code: 'service_busy', message: 'Service is busy, retry shortly' },
      });
    } finally {
      busy.release();
    }
  });

  it('answers unknown routes with 404 in the same format', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      success: false,
      error: { code: 'not_found', message: 'Route not found' },
    });
  });
});
