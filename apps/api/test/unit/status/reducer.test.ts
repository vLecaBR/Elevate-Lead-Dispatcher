import { describe, expect, it } from 'vitest';
import { reduceStatus, type StatusEvent } from '../../../src/modules/status/reducer.js';
import type { LeadStatus } from '../../../src/modules/status/state-machine.js';

const t = (minute: number) => new Date(Date.UTC(2026, 9, 15, 12, minute));

let nextId = 1;
function event(status: LeadStatus, minute: number): StatusEvent {
  return { id: nextId++, status, eventTs: t(minute) };
}

// Every ordering of the input; the reducer must not care in which order events arrived.
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) {
    return [items];
  }
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

// Arrival order is modelled by the id (insertion order), so each permutation also gets
// fresh ids in its own order, exactly like rows inserted as they arrive.
function arrivedInOrder(events: StatusEvent[]): StatusEvent[] {
  return events.map((e, i) => ({ ...e, id: 1000 + i }));
}

function expectSameResultForEveryArrivalOrder(events: StatusEvent[], expected: LeadStatus) {
  const results = permutations(events).map((order) => reduceStatus(arrivedInOrder(order)).status);
  expect(new Set(results)).toEqual(new Set([expected]));
}

describe('reduceStatus', () => {
  it('starts at new when there are no events', () => {
    expect(reduceStatus([])).toEqual({ status: 'new', statusSince: null });
  });

  it('applies events in event time, not in arrival order (sale then a late contacted)', () => {
    const arrived = [event('new', 0), event('sale', 20), event('contacted', 10)];

    expect(reduceStatus(arrived)).toEqual({ status: 'sale', statusSince: t(20) });
  });

  it('recovers a refund that arrived before its sale', () => {
    const refundOnly = [event('new', 0), event('refund', 30)];
    expect(reduceStatus(refundOnly).status).toBe('new'); // refund from new is invalid: ignored

    const thenSaleArrives = [...refundOnly, event('sale', 20)];
    expect(reduceStatus(thenSaleArrives)).toEqual({ status: 'refund', statusSince: t(30) });
  });

  it('ignores anything after a terminal status', () => {
    const events = [
      event('new', 0),
      event('invalid', 5),
      event('contacted', 10),
      event('sale', 15),
    ];

    expect(reduceStatus(events)).toEqual({ status: 'invalid', statusSince: t(5) });
  });

  it('skips invalid transitions but keeps applying later valid ones', () => {
    // qualified -> contacted is not allowed; qualified -> sale is.
    const events = [event('qualified', 1), event('contacted', 2), event('sale', 3)];

    expect(reduceStatus(events).status).toBe('sale');
  });

  it('breaks equal timestamps by status rank, independent of arrival', () => {
    expectSameResultForEveryArrivalOrder(
      [event('contacted', 5), event('qualified', 5), event('sale', 5)],
      'sale',
    );
  });

  it('gives the same final status for every arrival order of a realistic history', () => {
    // 6 events -> 720 arrival orders.
    expectSameResultForEveryArrivalOrder(
      [
        event('new', 0),
        event('no_answer', 10),
        event('callback', 20),
        event('contacted', 30),
        event('sale', 40),
        event('refund', 50),
      ],
      'refund',
    );
  });

  it('is order-independent even with duplicates and same-time conflicts', () => {
    expectSameResultForEveryArrivalOrder(
      [
        event('contacted', 10),
        event('contacted', 10),
        event('invalid', 10),
        event('qualified', 10),
        event('sale', 20),
      ],
      'invalid', // at minute 10: contacted -> qualified -> invalid (terminal), sale is ignored
    );
  });

  it('does not mutate its input', () => {
    const events = [event('sale', 2), event('contacted', 1)];
    const copy = structuredClone(events);

    reduceStatus(events);

    expect(events).toEqual(copy);
  });
});
