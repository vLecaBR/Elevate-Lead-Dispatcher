import { and, asc, desc, eq, gte, lt, type SQL, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.js';
import {
  affiliates,
  callCenters,
  distributions,
  funnels,
  leads,
  leadStatusEvents,
  products,
} from '../../db/schema.js';
import type { LeadStatus } from '../status/state-machine.js';
import type { Cursor, ListQuery } from './list-query.js';
import type { LeadScope } from './scope.js';

// User-facing lead queries. Every function takes the caller's LeadScope as a required
// argument and applies it in SQL, so a lead outside the scope is simply not found (the
// route answers 404, which does not reveal that it exists).
function inScope(scope: LeadScope, leadId: string): SQL {
  const byId = eq(leads.id, leadId);
  return scope.kind === 'all' ? byId : and(byId, eq(leads.callCenterId, scope.callCenterId))!;
}

export interface ListFilters extends Omit<ListQuery, 'cursor'> {
  after: Cursor | null;
  timeZone: string;
}

// Keyset pagination over (created_at DESC, id DESC): each page starts strictly after the
// last row of the previous one, so the cost does not grow with the page number (OFFSET
// would scan and discard every earlier row) and no COUNT(*) is needed. Every filter is a
// fixed column from the whitelist, values always bound as parameters. The composite
// indexes of migration 0001 (filter column + created_at DESC, id DESC) serve these.
export async function listLeads(db: Db, scope: LeadScope, filters: ListFilters) {
  const conditions: SQL[] = [];
  if (scope.kind === 'callCenter') {
    conditions.push(eq(leads.callCenterId, scope.callCenterId));
  }
  if (filters.status) {
    conditions.push(eq(leads.status, filters.status));
  }
  if (filters.source) {
    conditions.push(eq(leads.source, filters.source));
  }
  if (filters.product) {
    conditions.push(
      eq(leads.productId, sql`(SELECT id FROM products WHERE slug = ${filters.product})`),
    );
  }
  if (filters.funnel) {
    // Funnel slugs repeat across products (vsl-01): narrowed by product when given.
    conditions.push(
      filters.product
        ? eq(
            leads.funnelId,
            sql`(SELECT f.id FROM funnels f JOIN products p ON p.id = f.product_id
                 WHERE f.slug = ${filters.funnel} AND p.slug = ${filters.product})`,
          )
        : sql`${leads.funnelId} IN (SELECT id FROM funnels WHERE slug = ${filters.funnel})`,
    );
  }
  if (filters.call_center) {
    // ANDed with the scope: an OPERATOR naming another call center just gets nothing.
    conditions.push(
      eq(
        leads.callCenterId,
        sql`(SELECT id FROM call_centers WHERE slug = ${filters.call_center})`,
      ),
    );
  }
  // Day boundaries in the business timezone, not UTC: "from 2026-10-15" starts at
  // midnight in São Paulo. `to` is inclusive, so the bound is the next midnight.
  if (filters.from) {
    conditions.push(
      gte(
        leads.createdAt,
        sql`((${filters.from})::date)::timestamp AT TIME ZONE ${filters.timeZone}`,
      ),
    );
  }
  if (filters.to) {
    conditions.push(
      lt(
        leads.createdAt,
        sql`((${filters.to})::date + 1)::timestamp AT TIME ZONE ${filters.timeZone}`,
      ),
    );
  }
  if (filters.after) {
    conditions.push(
      sql`(${leads.createdAt}, ${leads.id}) < ((${filters.after.createdAt})::timestamptz, (${filters.after.id})::uuid)`,
    );
  }

  return (
    db
      .select({
        id: leads.id,
        name: leads.name,
        email: leads.email,
        phoneE164: leads.phoneE164,
        status: leads.status,
        source: leads.source,
        productSlug: products.slug,
        funnelSlug: funnels.slug,
        callCenterSlug: callCenters.slug,
        callCenterName: callCenters.name,
        createdAt: leads.createdAt,
        // Full precision, only for the next cursor (see Cursor in list-query.ts).
        createdAtText: sql<string>`${leads.createdAt}::text`,
        statusUpdatedAt: leads.statusUpdatedAt,
      })
      .from(leads)
      .innerJoin(products, eq(products.id, leads.productId))
      .innerJoin(funnels, eq(funnels.id, leads.funnelId))
      .leftJoin(callCenters, eq(callCenters.id, leads.callCenterId))
      .where(and(...conditions))
      .orderBy(desc(leads.createdAt), desc(leads.id))
      // One extra row tells whether there is a next page.
      .limit(filters.limit + 1)
  );
}

export async function findLeadDetail(db: Db, scope: LeadScope, leadId: string) {
  const [row] = await db
    .select({
      id: leads.id,
      name: leads.name,
      email: leads.email,
      phoneE164: leads.phoneE164,
      status: leads.status,
      statusUpdatedAt: leads.statusUpdatedAt,
      createdAt: leads.createdAt,
      source: leads.source,
      campaign: leads.campaign,
      utmSource: leads.utmSource,
      utmMedium: leads.utmMedium,
      utmCampaign: leads.utmCampaign,
      utmContent: leads.utmContent,
      utmTerm: leads.utmTerm,
      productSlug: products.slug,
      productName: products.name,
      funnelSlug: funnels.slug,
      funnelName: funnels.name,
      affiliateCode: affiliates.externalCode,
      callCenterId: callCenters.id,
      callCenterSlug: callCenters.slug,
      callCenterName: callCenters.name,
      distributedAt: leads.distributedAt,
      externalId: distributions.externalId,
    })
    .from(leads)
    .innerJoin(products, eq(products.id, leads.productId))
    .innerJoin(funnels, eq(funnels.id, leads.funnelId))
    .leftJoin(affiliates, eq(affiliates.id, leads.affiliateId))
    .leftJoin(callCenters, eq(callCenters.id, leads.callCenterId))
    .leftJoin(distributions, eq(distributions.leadId, leads.id))
    .where(inScope(scope, leadId));
  return row;
}

export async function listLeadHistory(db: Db, scope: LeadScope, leadId: string) {
  return db
    .select({
      status: leadStatusEvents.status,
      eventTs: leadStatusEvents.eventTs,
      receivedAt: leadStatusEvents.receivedAt,
      source: leadStatusEvents.source,
      note: leadStatusEvents.note,
    })
    .from(leadStatusEvents)
    .innerJoin(leads, eq(leads.id, leadStatusEvents.leadId))
    .where(inScope(scope, leadId))
    .orderBy(asc(leadStatusEvents.eventTs), asc(leadStatusEvents.id));
}

// Row lock for a manual status change, same lock the webhook takes (lead, then events).
export async function lockLeadInScope(
  tx: Tx,
  scope: LeadScope,
  leadId: string,
): Promise<{ id: string; status: LeadStatus } | undefined> {
  const [row] = await tx
    .select({ id: leads.id, status: leads.status })
    .from(leads)
    .where(inScope(scope, leadId))
    .for('update');
  return row;
}
