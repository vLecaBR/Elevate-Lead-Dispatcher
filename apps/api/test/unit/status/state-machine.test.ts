import { describe, expect, it } from 'vitest';
import {
  allowedNext,
  canTransition,
  isTerminal,
  LEAD_STATUSES,
  type LeadStatus,
} from '../../../src/modules/status/state-machine.js';

// PLAN.md §9.3, written out independently of the implementation: row = from, '✓' = allowed.
//               contacted no_answer callback qualified sale refund invalid
const table: Record<LeadStatus, string> = {
  new: '        ✓         ✓         ✓        ✓         ✓    -      ✓',
  contacted: '  -         ✓         ✓        ✓         ✓    -      ✓',
  no_answer: '  ✓         -         ✓        ✓         ✓    -      ✓',
  callback: '   ✓         ✓         -        ✓         ✓    -      ✓',
  qualified: '  -         -         ✓        -         ✓    -      ✓',
  sale: '       -         -         -        -         -    ✓      -',
  refund: '     -         -         -        -         -    -      -',
  invalid: '    -         -         -        -         -    -      -',
};
const targets: LeadStatus[] = [
  'contacted',
  'no_answer',
  'callback',
  'qualified',
  'sale',
  'refund',
  'invalid',
];

const cases = LEAD_STATUSES.flatMap((from) => {
  const marks = table[from].trim().split(/\s+/);
  return targets.map((to, i) => [from, to, marks[i] === '✓'] as const);
});

describe('state machine', () => {
  it.each(cases)('%s -> %s allowed: %s', (from, to, allowed) => {
    expect(canTransition(from, to)).toBe(allowed);
  });

  it('never transitions back to new', () => {
    for (const from of LEAD_STATUSES) {
      expect(canTransition(from, 'new')).toBe(false);
    }
  });

  it('treats the same status again as a no-op, not a transition', () => {
    for (const status of LEAD_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('marks refund and invalid as terminal', () => {
    expect(LEAD_STATUSES.filter(isTerminal)).toEqual(['refund', 'invalid']);
  });

  it('lists the allowed next statuses (what the UI may offer)', () => {
    expect(allowedNext('qualified')).toEqual(['callback', 'sale', 'invalid']);
    expect(allowedNext('sale')).toEqual(['refund']);
    expect(allowedNext('invalid')).toEqual([]);
  });
});
