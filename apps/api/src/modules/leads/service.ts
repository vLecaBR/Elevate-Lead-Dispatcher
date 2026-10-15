import type { Db } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import { uuidv7 } from '../../shared/uuid.js';
import { insertStatusEvent } from '../status/repository.js';
import { buildDedupeKey, buildRequestHash } from './dedupe.js';
import {
  findActiveFunnelId,
  findActiveProductId,
  findLeadByDedupeKey,
  findOrCreateAffiliateId,
  insertLeadIfNew,
} from './repository.js';
import type { LeadInput } from './schema.js';

export interface CreateLeadResult {
  leadId: string;
  duplicate: boolean;
}

export async function createLead(
  db: Db,
  input: LeadInput,
  idempotencyKey: string | undefined,
): Promise<CreateLeadResult> {
  // Catalog lookups happen before the transaction: they only read, and failing early
  // keeps invalid requests from opening a transaction at all.
  const productId = await findActiveProductId(db, input.product);
  if (!productId) {
    throw unknown('product', 'unknown_product', 'Unknown or inactive product');
  }
  const funnelId = await findActiveFunnelId(db, productId, input.funnel);
  if (!funnelId) {
    throw unknown('funnel', 'unknown_funnel', 'Unknown or inactive funnel for this product');
  }

  const dedupeKey = buildDedupeKey(input, idempotencyKey);
  const requestHash = buildRequestHash(input);

  return db.transaction(async (tx) => {
    const affiliateId = input.affiliateCode
      ? await findOrCreateAffiliateId(tx, input.affiliateCode)
      : null;

    const inserted = await insertLeadIfNew(tx, {
      id: uuidv7(),
      name: input.name,
      email: input.email,
      phoneE164: input.phoneE164,
      productId,
      funnelId,
      affiliateId,
      source: input.source,
      campaign: input.campaign ?? null,
      utmSource: input.utm?.source ?? null,
      utmMedium: input.utm?.medium ?? null,
      utmCampaign: input.utm?.campaign ?? null,
      utmContent: input.utm?.content ?? null,
      utmTerm: input.utm?.term ?? null,
      dedupeKey,
      requestHash,
    });

    if (!inserted) {
      // Lost the race or a replay: the row exists (committed), report it instead of
      // creating a second lead.
      const existing = await findLeadByDedupeKey(tx, dedupeKey);
      if (!existing) {
        throw new Error(`dedupe conflict without a row for ${dedupeKey}`);
      }
      if (idempotencyKey !== undefined && existing.requestHash !== requestHash) {
        throw new AppError(
          422,
          'idempotency_key_reuse',
          'Idempotency-Key was already used with a different request body',
        );
      }
      return { leadId: existing.id, duplicate: true };
    }

    // History starts with `new` so the reducer always replays from the first state.
    await insertStatusEvent(tx, {
      leadId: inserted.id,
      status: 'new',
      eventTs: inserted.createdAt,
      source: 'system',
      eventKey: 'system:new',
    });

    return { leadId: inserted.id, duplicate: false };
  });
}

function unknown(field: string, code: string, message: string): AppError {
  return new AppError(422, code, message, [{ field, issue: code }]);
}
