import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { leads } from '../../db/schema.js';

// Metric definitions (they go to the README as written here):
// - total:       every lead ever received (duplicates are never stored twice).
// - today:       leads created since midnight in APP_TIMEZONE (not UTC midnight).
// - distributed: leads assigned to a call center; pending = not assigned yet.
// - sales:       leads whose CURRENT status is `sale` (a refunded sale no longer counts).
// One pass over the table with FILTER instead of five separate COUNT(*). At ~1M+ leads
// this moves to a daily aggregates table (PLAN.md §15).
export async function countLeads(db: Db, timeZone: string) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      today: sql<number>`(count(*) FILTER (
        WHERE ${leads.createdAt} >= date_trunc('day', now() AT TIME ZONE ${timeZone}) AT TIME ZONE ${timeZone}
      ))::int`,
      distributed: sql<number>`(count(*) FILTER (WHERE ${leads.callCenterId} IS NOT NULL))::int`,
      pending: sql<number>`(count(*) FILTER (WHERE ${leads.callCenterId} IS NULL))::int`,
      sales: sql<number>`(count(*) FILTER (WHERE ${leads.status} = 'sale'))::int`,
    })
    .from(leads);
  return row!;
}

export async function countLeadsByStatus(db: Db) {
  return db
    .select({ status: leads.status, count: sql<number>`count(*)::int` })
    .from(leads)
    .groupBy(leads.status);
}
