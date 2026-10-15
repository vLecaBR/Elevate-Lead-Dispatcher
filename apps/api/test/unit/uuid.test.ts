import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '../../src/shared/uuid.js';

const uuidFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function embeddedMillis(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('uuidv7', () => {
  it('has the canonical format with version 7 and RFC 9562 variant', () => {
    const id = uuidv7();

    expect(id).toMatch(uuidFormat);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('embeds the current Unix time in milliseconds in the first 48 bits', () => {
    vi.useFakeTimers({ now: new Date('2026-10-15T12:00:00.123Z') });

    expect(embeddedMillis(uuidv7())).toBe(Date.parse('2026-10-15T12:00:00.123Z'));
  });

  it('sorts by creation time across milliseconds', () => {
    vi.useFakeTimers({ now: 1_000 });
    const earlier = uuidv7();
    vi.setSystemTime(1_001);
    const later = uuidv7();

    expect(earlier < later).toBe(true);
  });

  it('does not repeat within the same millisecond', () => {
    vi.useFakeTimers({ now: 1_000 });
    const ids = new Set(Array.from({ length: 1_000 }, () => uuidv7()));

    expect(ids.size).toBe(1_000);
  });
});
