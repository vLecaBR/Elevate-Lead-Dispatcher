import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { callCenters, funnels, leads, products } from '../../db/schema.js';
import type { LeadScope } from '../leads/scope.js';

export async function listActiveFunnels(db: Db) {
  return db
    .select({
      productSlug: products.slug,
      productName: products.name,
      funnelSlug: funnels.slug,
      funnelName: funnels.name,
    })
    .from(funnels)
    .innerJoin(products, eq(products.id, funnels.productId))
    .where(and(eq(products.isActive, true), eq(funnels.isActive, true)))
    .orderBy(asc(products.slug), asc(funnels.slug));
}

// An OPERATOR only sees their own call center (the scope also hides the others' names).
export async function listCallCenters(db: Db, scope: LeadScope) {
  return db
    .select({ id: callCenters.id, slug: callCenters.slug, name: callCenters.name })
    .from(callCenters)
    .where(scope.kind === 'all' ? undefined : eq(callCenters.id, scope.callCenterId))
    .orderBy(asc(callCenters.id));
}

// Sources that appear in the leads the user can see. Served by the (source, created_at, id)
// index; Postgres 17 has no skip scan, so at ~10M leads this becomes a small table of
// known sources maintained on insert (documented trade-off).
export async function listSources(db: Db, scope: LeadScope): Promise<string[]> {
  const rows = await db
    .selectDistinct({ source: leads.source })
    .from(leads)
    .where(
      and(
        isNotNull(leads.source),
        scope.kind === 'all' ? undefined : eq(leads.callCenterId, scope.callCenterId),
      ),
    )
    .orderBy(asc(leads.source));
  return rows.map((row) => row.source!);
}
