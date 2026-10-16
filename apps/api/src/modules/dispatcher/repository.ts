import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.js';
import { callCenters, distributions, leads } from '../../db/schema.js';
import type { CenterState } from './algorithm.js';

// Timeouts apply to the current transaction only (set_config(..., true) = SET LOCAL).
// set_config takes bind parameters, unlike SET, so no value is interpolated into SQL.
export async function setLocalTimeouts(
  tx: Tx,
  lockTimeoutMs: number,
  statementTimeoutMs: number,
): Promise<void> {
  await tx.execute(
    sql`SELECT set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, true),
               set_config('statement_timeout', ${`${statementTimeoutMs}ms`}, true)`,
  );
}

// The serialization point of the dispatcher. FOR UPDATE makes concurrent dispatchers
// wait here until the holder commits; under READ COMMITTED the waiter then re-reads the
// locked rows and sees the committed credits, so no pick is made on stale state.
// ORDER BY id fixes the lock acquisition order, so two dispatchers can never deadlock.
export async function lockEligibleCallCenters(tx: Tx): Promise<CenterState[]> {
  return tx
    .select({ id: callCenters.id, weight: callCenters.weight, credit: callCenters.dispatchCredit })
    .from(callCenters)
    .where(and(eq(callCenters.isActive, true), gt(callCenters.weight, 0)))
    .orderBy(asc(callCenters.id))
    .for('update');
}

export async function saveCredits(tx: Tx, credits: Map<number, number>): Promise<void> {
  // One row per call center: a handful of updates on rows we already hold locked.
  for (const [id, credit] of credits) {
    await tx.update(callCenters).set({ dispatchCredit: credit }).where(eq(callCenters.id, id));
  }
}

// distributed_at defaults to now(), which is the transaction start time.
export async function insertDistribution(
  tx: Tx,
  distribution: Omit<typeof distributions.$inferInsert, 'distributedAt'>,
): Promise<void> {
  await tx.insert(distributions).values(distribution);
}

// Mirrors the choice on the lead (same transaction as the distribution row). now() is
// constant within a transaction, so both timestamps are identical to the microsecond
// (passing a JS Date back would truncate to milliseconds). The `call_center_id IS NULL`
// guard keeps an already distributed lead untouched.
export async function assignLeadToCallCenter(
  tx: Tx,
  leadId: string,
  callCenterId: number,
): Promise<void> {
  await tx
    .update(leads)
    .set({ callCenterId, distributedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(leads.id, leadId), isNull(leads.callCenterId)));
}

// Pending queue, oldest first (UUIDv7 ids grow with time, and the partial index
// leads_pending_idx serves this). SKIP LOCKED lets two redispatch runs split the work
// instead of waiting on each other.
export async function lockPendingLeadIds(tx: Tx, limit: number): Promise<string[]> {
  const rows = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(isNull(leads.callCenterId))
    .orderBy(asc(leads.id))
    .limit(limit)
    .for('update', { skipLocked: true });
  return rows.map((row) => row.id);
}

export async function countPendingLeads(db: Db): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .where(isNull(leads.callCenterId));
  return row!.count;
}
