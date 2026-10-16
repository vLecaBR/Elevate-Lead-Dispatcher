import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
// The handle inside db.transaction(): repository functions that must run in the caller's
// transaction take a Tx, so they cannot be called outside one by mistake.
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

// Wraps an existing pool so the app, tests and scripts control its size and lifecycle.
export function createDb(pool: pg.Pool): Db {
  return drizzle({ client: pool, schema });
}

export interface PoolOptions {
  max?: number;
  // How long a request may wait for a free connection (also covers connecting).
  connectionTimeoutMs?: number;
  onIdleClientError: (error: Error) => void;
}

export function createPool(
  connectionString: string,
  { max = 10, connectionTimeoutMs = 5_000, onIdleClientError }: PoolOptions,
): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    // Default is 0 (wait forever): under overload requests would pile up indefinitely and
    // /ready would hang. With a bound, the error handler answers 503 + Retry-After.
    connectionTimeoutMillis: connectionTimeoutMs,
  });
  // When the server drops an idle connection (restart, failover), pg emits 'error' on the
  // pool. Without a listener Node treats it as unhandled and kills the process. The pool
  // discards that client and opens a new one on the next query, so logging is enough.
  pool.on('error', onIdleClientError);
  return pool;
}

export async function pingDatabase(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
