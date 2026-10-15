import { randomFillSync } from 'node:crypto';

// UUID version 7 (RFC 9562): 48-bit Unix time in ms, then random bits. Ids created later
// sort later, so inserts land at the right edge of the primary key index instead of at
// random pages (better locality than v4). Node and Postgres 17 have no built-in v7.
export function uuidv7(): string {
  const bytes = randomFillSync(new Uint8Array(16));
  const now = Date.now();

  // Bytes 0-5: timestamp, big-endian. Division instead of bit shifts: shifts in JS are
  // 32-bit and the timestamp needs 48.
  for (let i = 5, value = now; i >= 0; i -= 1, value = Math.floor(value / 256)) {
    bytes[i] = value % 256;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10

  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
