import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

// Wraps an existing pool so the app, tests and scripts control its size and lifecycle.
export function createDb(pool: pg.Pool): Db {
  return drizzle({ client: pool, schema });
}

export interface PoolOptions {
  max?: number;
  onIdleClientError: (error: Error) => void;
}

export function createPool(
  connectionString: string,
  { max = 10, onIdleClientError }: PoolOptions,
): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    // Default is 0 (wait forever): /ready would hang instead of answering 503.
    connectionTimeoutMillis: 5_000,
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
