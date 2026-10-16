import type { Db, Tx } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import { isPgError } from '../../shared/pg-errors.js';
import { type CenterState, pickSwrr } from './algorithm.js';
import {
  assignLeadToCallCenter,
  countPendingLeads,
  insertDistribution,
  lockEligibleCallCenters,
  lockPendingLeadIds,
  saveCredits,
  setLocalTimeouts,
} from './repository.js';

export interface DispatchConfig {
  lockTimeoutMs: number;
}

const STATEMENT_TIMEOUT_MS = 5_000;
// SQLSTATE 55P03 lock_not_available: lock_timeout expired while waiting.
const LOCK_NOT_AVAILABLE = '55P03';

// Assigns one freshly inserted lead to a call center, inside the caller's transaction.
// Returns the chosen call center id, or null when none is eligible (lead stays pending).
export async function dispatchLead(
  tx: Tx,
  leadId: string,
  config: DispatchConfig,
): Promise<number | null> {
  return withBusyMapping(async () => {
    await setLocalTimeouts(tx, config.lockTimeoutMs, STATEMENT_TIMEOUT_MS);
    const centers = await lockEligibleCallCenters(tx);
    const pick = pickSwrr(centers);
    if (!pick) {
      return null;
    }
    await recordDistribution(tx, leadId, centers, pick.chosenId, pick.credits);
    return pick.chosenId;
  });
}

export interface RedispatchResult {
  distributed: number;
  remaining: number;
}

// Distributes pending leads (created while no call center was eligible) in creation
// order, one transaction per batch so locks are never held for the whole backlog.
export async function redispatchPending(
  db: Db,
  config: DispatchConfig,
  batchSize = 100,
): Promise<RedispatchResult> {
  let distributed = 0;
  for (;;) {
    const batch = await db.transaction((tx) =>
      withBusyMapping(async () => {
        await setLocalTimeouts(tx, config.lockTimeoutMs, STATEMENT_TIMEOUT_MS);
        // Same order as the intake: lead rows first, then call centers.
        const leadIds = await lockPendingLeadIds(tx, batchSize);
        if (leadIds.length === 0) {
          return { done: 0, stop: true };
        }
        let centers = await lockEligibleCallCenters(tx);
        let done = 0;
        for (const leadId of leadIds) {
          const pick = pickSwrr(centers);
          if (!pick) {
            return { done, stop: true };
          }
          await recordDistribution(tx, leadId, centers, pick.chosenId, pick.credits);
          centers = centers.map((c) => ({ ...c, credit: pick.credits.get(c.id) ?? c.credit }));
          done += 1;
        }
        return { done, stop: leadIds.length < batchSize };
      }),
    );
    distributed += batch.done;
    if (batch.stop) {
      break;
    }
  }
  const remaining = await countPendingLeads(db);
  return { distributed, remaining };
}

async function recordDistribution(
  tx: Tx,
  leadId: string,
  centersBefore: CenterState[],
  chosenId: number,
  newCredits: Map<number, number>,
): Promise<void> {
  await saveCredits(tx, newCredits);
  await insertDistribution(tx, {
    leadId,
    callCenterId: chosenId,
    strategy: 'swrr',
    // Audit: the state the decision was made on.
    weightsSnapshot: centersBefore.map(({ id, weight, credit }) => ({ id, weight, credit })),
  });
  await assignLeadToCallCenter(tx, leadId, chosenId);
}

// Under saturation, fail fast with 503 + Retry-After instead of piling up connections.
// The whole transaction rolls back (no half-created lead); a retry is safe because the
// intake is idempotent.
async function withBusyMapping<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isPgError(error, LOCK_NOT_AVAILABLE)) {
      throw new AppError(503, 'dispatch_busy', 'Dispatcher is busy, retry shortly', undefined, {
        'retry-after': '1',
      });
    }
    throw error;
  }
}
