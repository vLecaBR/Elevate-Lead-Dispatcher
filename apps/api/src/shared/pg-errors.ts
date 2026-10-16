import pg from 'pg';

// Drizzle wraps driver errors (DrizzleQueryError with the original error as `cause`), so
// the interesting error may be the one thrown or one level down.
function unwrap(error: unknown): unknown {
  return error instanceof Error && !(error instanceof pg.DatabaseError) && error.cause
    ? error.cause
    : error;
}

export function isPgError(error: unknown, sqlState: string): boolean {
  const candidate = unwrap(error);
  return candidate instanceof pg.DatabaseError && candidate.code === sqlState;
}

// pg-pool gives up waiting for a free connection (connectionTimeoutMillis). It throws a
// plain Error without a code, so the message is the only stable signal it offers.
export function isPoolExhausted(error: unknown): boolean {
  const candidate = unwrap(error);
  return (
    candidate instanceof Error && candidate.message === 'timeout exceeded when trying to connect'
  );
}
