import { eq } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.js';
import { callCenters, distributions } from '../../db/schema.js';

// Internal only: the secret is used in memory to verify the HMAC and is never serialized.
export async function findCallCenterBySlug(
  db: Db,
  slug: string,
): Promise<{ id: number; webhookSecret: string } | undefined> {
  const [row] = await db
    .select({ id: callCenters.id, webhookSecret: callCenters.webhookSecret })
    .from(callCenters)
    .where(eq(callCenters.slug, slug));
  return row;
}

export async function getDistributionExternalId(
  tx: Tx,
  leadId: string,
): Promise<string | null | undefined> {
  const [row] = await tx
    .select({ externalId: distributions.externalId })
    .from(distributions)
    .where(eq(distributions.leadId, leadId));
  return row?.externalId;
}

export async function setDistributionExternalId(
  tx: Tx,
  leadId: string,
  externalId: string,
): Promise<void> {
  await tx.update(distributions).set({ externalId }).where(eq(distributions.leadId, leadId));
}
