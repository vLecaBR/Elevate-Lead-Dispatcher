import { describe, expect, it } from 'vitest';
import { pickSwrr, type CenterState } from '../../../src/modules/dispatcher/algorithm.js';

const A = 1;
const B = 2;
const C = 3;
const names: Record<number, string> = { [A]: 'A', [B]: 'B', [C]: 'C' };

function centers(...weights: number[]): CenterState[] {
  return weights.map((weight, index) => ({ id: index + 1, weight, credit: 0 }));
}

// Runs n picks feeding the new credits back in, like consecutive transactions would.
function run(state: CenterState[], n: number): { picks: number[]; state: CenterState[] } {
  const picks: number[] = [];
  let current = state;
  for (let i = 0; i < n; i += 1) {
    const result = pickSwrr(current);
    if (!result) {
      throw new Error('no eligible center');
    }
    picks.push(result.chosenId);
    current = current.map((c) => ({ ...c, credit: result.credits.get(c.id) ?? c.credit }));
  }
  return { picks, state: current };
}

describe('pickSwrr', () => {
  it('follows the golden sequence for weights 50/30/20 and returns credits to zero', () => {
    const { picks, state } = run(centers(50, 30, 20), 10);

    expect(picks.map((id) => names[id]).join(',')).toBe('A,B,C,A,A,B,A,C,B,A');
    expect(state.map((c) => c.credit)).toEqual([0, 0, 0]);
  });

  it('splits 100 picks exactly 50/30/20', () => {
    const { picks } = run(centers(50, 30, 20), 100);

    expect([A, B, C].map((id) => picks.filter((p) => p === id).length)).toEqual([50, 30, 20]);
  });

  it('treats weights as relative (2:1 does not need to sum to 100)', () => {
    const { picks } = run(centers(2, 1), 30);

    expect([A, B].map((id) => picks.filter((p) => p === id).length)).toEqual([20, 10]);
    expect(picks.slice(0, 3)).toEqual([A, B, A]); // smooth: interleaves instead of A,A,B
  });

  it('leaves a weight-0 center out of the rotation and out of the credits', () => {
    const { picks } = run(centers(50, 0, 50), 10);
    const result = pickSwrr(centers(50, 0, 50));

    expect(picks).not.toContain(B);
    expect(result?.credits.has(B)).toBe(false);
  });

  it('returns null when no center is eligible', () => {
    expect(pickSwrr([])).toBeNull();
    expect(pickSwrr(centers(0, 0))).toBeNull();
  });

  it('always picks the only eligible center', () => {
    const { picks, state } = run(centers(7), 5);

    expect(picks).toEqual([A, A, A, A, A]);
    expect(state[0]!.credit).toBe(0);
  });

  it('breaks ties by the lowest id regardless of input order', () => {
    const shuffled: CenterState[] = [
      { id: C, weight: 10, credit: 0 },
      { id: A, weight: 10, credit: 0 },
      { id: B, weight: 10, credit: 0 },
    ];

    expect(pickSwrr(shuffled)?.chosenId).toBe(A);
  });

  it('does not mutate its input', () => {
    const input = centers(50, 30, 20);
    const copy = structuredClone(input);

    pickSwrr(input);

    expect(input).toEqual(copy);
  });
});
