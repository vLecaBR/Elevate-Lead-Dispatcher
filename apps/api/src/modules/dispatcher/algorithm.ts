// Smooth Weighted Round Robin (the algorithm nginx uses for weighted upstreams).
// Pure: no I/O, the caller loads the state and persists the new credits.
//
// Each pick: every eligible center gains its weight in credit; the one with the most
// credit wins and pays back the total weight. Over any window of sum(weights) picks the
// split is exact (5/3/2 for 50/30/20 every 10 leads) and credits return to zero, and
// picks are interleaved (A,B,C,A,A,B,A,C,B,A) instead of five A's in a row.

export interface CenterState {
  id: number;
  weight: number;
  credit: number;
}

export interface SwrrPick {
  chosenId: number;
  // New credit for every eligible center (including the chosen one).
  credits: Map<number, number>;
}

export function pickSwrr(centers: readonly CenterState[]): SwrrPick | null {
  // Sorted by id so ties go to the lowest id: the result depends only on the state,
  // never on the order the rows came in.
  const eligible = centers.filter((c) => c.weight > 0).sort((a, b) => a.id - b.id);
  if (eligible.length === 0) {
    return null;
  }

  const totalWeight = eligible.reduce((sum, c) => sum + c.weight, 0);
  const credits = new Map(eligible.map((c) => [c.id, c.credit + c.weight]));

  let chosenId = eligible[0]!.id;
  for (const center of eligible) {
    // Strictly greater: on a tie the earlier (lower id) center keeps the pick.
    if (credits.get(center.id)! > credits.get(chosenId)!) {
      chosenId = center.id;
    }
  }
  credits.set(chosenId, credits.get(chosenId)! - totalWeight);

  return { chosenId, credits };
}
