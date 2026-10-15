import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.js';

const validDatabaseUrl = 'postgres://elevate:elevate@localhost:5432/elevate';

describe('parseEnv', () => {
  it('applies defaults when only DATABASE_URL is set', () => {
    const env = parseEnv({ DATABASE_URL: validDatabaseUrl });

    expect(env).toEqual({
      NODE_ENV: 'development',
      API_HOST: '0.0.0.0',
      API_PORT: 3001,
      DATABASE_URL: validDatabaseUrl,
      LOG_LEVEL: 'info',
    });
  });

  it('coerces API_PORT from string', () => {
    expect(parseEnv({ DATABASE_URL: validDatabaseUrl, API_PORT: '8080' }).API_PORT).toBe(8080);
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it('fails when DATABASE_URL is not a postgres URL', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
  });

  it('fails on an out-of-range port', () => {
    expect(() => parseEnv({ DATABASE_URL: validDatabaseUrl, API_PORT: '70000' })).toThrow(
      /API_PORT/,
    );
  });
});
