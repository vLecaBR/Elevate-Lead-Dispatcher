import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { serializeError } from '../../src/shared/log-serializers.js';
import { createTestPool } from '../helpers/db.js';

const pool = createTestPool(1);
const db = createDb(pool);

afterAll(() => pool.end());

// Regression (independent review, M2): Drizzle's query error carries the bound parameters
// (name, e-mail, phone of a lead) in `params` and in the message; logging the raw error on a
// 500 wrote personal data to the logs, past the e-mail/phone redaction paths.
describe('serializeError', () => {
  it('keeps what is needed to debug a database error and drops the bound values', async () => {
    const email = 'ana.private@example.com';
    const error = await db
      .execute(sql`SELECT ${email}::int`)
      .then(() => undefined)
      .catch((caught: unknown) => caught);

    const serialized = serializeError(error);
    const text = JSON.stringify(serialized);

    expect(text).not.toContain(email);
    expect(serialized).toMatchObject({
      type: 'DrizzleQueryError',
      sqlState: '22P02', // invalid_text_representation
    });
    expect(serialized.message).toContain('Failed query');
    expect(serialized.stack).toContain('    at ');
  });

  it('handles plain errors and non-errors', () => {
    expect(serializeError(new Error('boom'))).toMatchObject({ type: 'Error', message: 'boom' });
    expect(serializeError('text')).toEqual({ type: 'unknown', message: 'text', stack: '' });
  });
});
