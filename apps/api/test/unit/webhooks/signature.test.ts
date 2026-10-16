import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signWebhook, verifyWebhookSignature } from '../../../src/modules/webhooks/signature.js';

const secret = 'dev-webhook-secret-cc-a';
const rawBody = Buffer.from('{"lead_id":"x","status":"sale"}');
const now = 1_792_000_000; // unix seconds
const tolerance = 300;

function verify(overrides: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) {
  return verifyWebhookSignature({
    secret,
    timestamp: String(now),
    signature: signWebhook(secret, String(now), rawBody),
    rawBody,
    nowSeconds: now,
    toleranceSeconds: tolerance,
    ...overrides,
  });
}

describe('signWebhook', () => {
  it('is HMAC-SHA256 over "<timestamp>.<raw body>", hex, with a sha256= prefix', () => {
    const expected = createHmac('sha256', secret).update(`${now}.`).update(rawBody).digest('hex');

    expect(signWebhook(secret, String(now), rawBody)).toBe(`sha256=${expected}`);
  });
});

describe('verifyWebhookSignature', () => {
  it('accepts a valid signature', () => {
    expect(verify()).toBe('ok');
  });

  it('accepts a timestamp inside the tolerance window (both directions)', () => {
    for (const ts of [now - tolerance, now + tolerance]) {
      const timestamp = String(ts);
      expect(verify({ timestamp, signature: signWebhook(secret, timestamp, rawBody) })).toBe('ok');
    }
  });

  it('rejects a body changed after signing (even one byte or whitespace)', () => {
    expect(verify({ rawBody: Buffer.from('{"lead_id":"x","status":"refund"}') })).toBe('mismatch');
    expect(verify({ rawBody: Buffer.from('{"lead_id": "x","status":"sale"}') })).toBe('mismatch');
  });

  it('rejects a signature made with another secret', () => {
    expect(verify({ signature: signWebhook('other-secret', String(now), rawBody) })).toBe(
      'mismatch',
    );
  });

  it('rejects a timestamp that does not match the signed one', () => {
    expect(verify({ timestamp: String(now - 1) })).toBe('mismatch');
  });

  it('rejects old and far-future timestamps (replay window)', () => {
    for (const ts of [now - tolerance - 1, now + tolerance + 1]) {
      const timestamp = String(ts);
      expect(verify({ timestamp, signature: signWebhook(secret, timestamp, rawBody) })).toBe(
        'expired',
      );
    }
  });

  it.each([
    ['missing timestamp', { timestamp: undefined }, 'missing'],
    ['missing signature', { signature: undefined }, 'missing'],
    ['non-numeric timestamp', { timestamp: '12abc' }, 'malformed'],
    ['decimal timestamp', { timestamp: '1.5' }, 'malformed'],
    ['signature without prefix', { signature: 'a'.repeat(64) }, 'malformed'],
    ['other algorithm prefix', { signature: `sha1=${'a'.repeat(64)}` }, 'malformed'],
    ['short hex', { signature: `sha256=${'a'.repeat(63)}` }, 'malformed'],
    ['non-hex characters', { signature: `sha256=${'z'.repeat(64)}` }, 'malformed'],
  ] as const)('rejects %s', (_label, overrides, reason) => {
    expect(verify(overrides)).toBe(reason);
  });
});
