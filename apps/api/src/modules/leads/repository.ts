import { and, eq } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.js';
import { affiliates, funnels, leads, products } from '../../db/schema.js';

// Intake (system) queries. No call center scope here: the public intake acts as the
// system, not as a user. User-facing queries live in scoped-repository.ts and all of
// them require a LeadScope.

export async function findActiveProductId(db: Db, slug: string): Promise<string | undefined> {
  const [row] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.slug, slug), eq(products.isActive, true)))
    .limit(1);
  return row?.id;
}

export async function findActiveFunnelId(
  db: Db,
  productId: string,
  slug: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: funnels.id })
    .from(funnels)
    .where(
      and(eq(funnels.productId, productId), eq(funnels.slug, slug), eq(funnels.isActive, true)),
    )
    .limit(1);
  return row?.id;
}

// Insert-or-ignore then read: under READ COMMITTED, if another transaction is inserting
// the same code, our INSERT waits for it and the SELECT (new statement, new snapshot)
// sees its committed row. An unknown affiliate never makes us lose the lead.
export async function findOrCreateAffiliateId(tx: Tx, externalCode: string): Promise<string> {
  await tx
    .insert(affiliates)
    .values({ externalCode })
    .onConflictDoNothing({ target: affiliates.externalCode });
  const [row] = await tx
    .select({ id: affiliates.id })
    .from(affiliates)
    .where(eq(affiliates.externalCode, externalCode));
  return row!.id;
}

export type NewLead = typeof leads.$inferInsert;

// The UNIQUE(dedupe_key) constraint is the arbiter of duplicates: of N concurrent inserts
// with the same key exactly one returns a row, the others get nothing back.
export async function insertLeadIfNew(
  tx: Tx,
  lead: NewLead,
): Promise<{ id: string; createdAt: Date } | undefined> {
  const [row] = await tx
    .insert(leads)
    .values(lead)
    .onConflictDoNothing({ target: leads.dedupeKey })
    .returning({ id: leads.id, createdAt: leads.createdAt });
  return row;
}

export async function findLeadByDedupeKey(
  tx: Tx,
  dedupeKey: string,
): Promise<{ id: string; requestHash: string } | undefined> {
  const [row] = await tx
    .select({ id: leads.id, requestHash: leads.requestHash })
    .from(leads)
    .where(eq(leads.dedupeKey, dedupeKey));
  return row;
}
