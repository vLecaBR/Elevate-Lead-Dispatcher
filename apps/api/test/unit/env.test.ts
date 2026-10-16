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
      SEED_DEMO: false,
      DEFAULT_PHONE_REGION: 'BR',
      DISPATCH_LOCK_TIMEOUT_MS: 3000,
      WEBHOOK_TOLERANCE_SECONDS: 300,
      SESSION_TTL_HOURS: 8,
      COOKIE_SECURE: true, // secure unless explicitly turned off for local http
      ALLOWED_ORIGINS: ['http://localhost:3000'],
      TRUST_PROXY: [],
      APP_TIMEZONE: 'America/Sao_Paulo',
      RATE_LIMIT_GLOBAL_PER_MIN: 300,
      RATE_LIMIT_LEADS_PER_MIN: 60,
      RATE_LIMIT_WEBHOOK_PER_MIN: 120,
      RATE_LIMIT_LOGIN_PER_MIN: 5,
    });
  });

  it('rejects an unknown APP_TIMEZONE', () => {
    expect(() => parseEnv({ DATABASE_URL: validDatabaseUrl, APP_TIMEZONE: 'Mars/Base' })).toThrow(
      /APP_TIMEZONE/,
    );
  });

  it('splits ALLOWED_ORIGINS and rejects entries that are not URLs', () => {
    expect(
      parseEnv({
        DATABASE_URL: validDatabaseUrl,
        ALLOWED_ORIGINS: 'http://localhost:3000, https://app.example.com',
      }).ALLOWED_ORIGINS,
    ).toEqual(['http://localhost:3000', 'https://app.example.com']);
    expect(() =>
      parseEnv({ DATABASE_URL: validDatabaseUrl, ALLOWED_ORIGINS: 'localhost' }),
    ).toThrow(/ALLOWED_ORIGINS/);
  });

  it('rejects a phone region libphonenumber does not know', () => {
    expect(() => parseEnv({ DATABASE_URL: validDatabaseUrl, DEFAULT_PHONE_REGION: 'XX' })).toThrow(
      /DEFAULT_PHONE_REGION/,
    );
  });

  it('parses SEED_DEMO strictly ("false" stays false)', () => {
    expect(parseEnv({ DATABASE_URL: validDatabaseUrl, SEED_DEMO: 'true' }).SEED_DEMO).toBe(true);
    expect(parseEnv({ DATABASE_URL: validDatabaseUrl, SEED_DEMO: 'false' }).SEED_DEMO).toBe(false);
    expect(() => parseEnv({ DATABASE_URL: validDatabaseUrl, SEED_DEMO: 'yes' })).toThrow(
      /SEED_DEMO/,
    );
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
