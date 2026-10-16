import type { Db } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import {
  countPendingLeads,
  lockAllCallCenters,
  resetAllCredits,
  summarizeCallCenters,
  updateCallCenterConfig,
} from './repository.js';

const percent = (part: number, whole: number) =>
  whole === 0 ? 0 : Number(((100 * part) / whole).toFixed(2));

// Target split (from the weights of the call centers in rotation) next to the real split
// (from the distributions recorded), plus the pending queue.
export async function getDispatcherSummary(db: Db) {
  const [centers, pending] = await Promise.all([summarizeCallCenters(db), countPendingLeads(db)]);
  const inRotation = (c: { isActive: boolean; weight: number }) => c.isActive && c.weight > 0;
  const totalWeight = centers.filter(inRotation).reduce((sum, c) => sum + c.weight, 0);
  const totalDistributed = centers.reduce((sum, c) => sum + c.distributed, 0);

  return {
    pending,
    callCenters: centers.map((c) => ({
      ...c,
      targetPct: inRotation(c) ? percent(c.weight, totalWeight) : 0,
      actualPct: percent(c.distributed, totalDistributed),
    })),
  };
}

// Weight or active flag change (PLAN.md §8). All credits are reset in the same
// transaction: otherwise credits built under the old weights would make the dispatcher
// send a burst of compensating leads to one call center right after the change.
export async function changeCallCenterConfig(
  db: Db,
  id: number,
  changes: { weight?: number; isActive?: boolean },
) {
  return db.transaction(async (tx) => {
    const ids = await lockAllCallCenters(tx);
    if (!ids.includes(id)) {
      throw new AppError(404, 'call_center_not_found', 'Call center not found');
    }
    const updated = await updateCallCenterConfig(tx, id, changes);
    await resetAllCredits(tx);
    return updated!;
  });
}
