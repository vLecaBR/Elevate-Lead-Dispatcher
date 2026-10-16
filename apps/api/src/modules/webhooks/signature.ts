import { createHmac, timingSafeEqual } from 'node:crypto';

// Webhook authentication (PLAN.md §9.1). Pure: no I/O, the clock is a parameter.
//
// signature = "sha256=" + hex(HMAC_SHA256(secret, timestamp + "." + rawBody))
// - Signed over the RAW bytes: re-serializing parsed JSON would change spacing or key
//   order and break (or, worse, weaken) the check.
// - The timestamp is inside the MAC, so it cannot be swapped; checking it against a
//   window limits replays of a captured request.
// - The secret never travels; only proof of knowing it does.

export type SignatureCheck = 'ok' | 'missing' | 'malformed' | 'expired' | 'mismatch';

const SIGNATURE_FORMAT = /^sha256=([0-9a-f]{64})$/;
const TIMESTAMP_FORMAT = /^\d{1,12}$/;

export function signWebhook(secret: string, timestamp: string, rawBody: Buffer): string {
  return `sha256=${hmacHex(secret, timestamp, rawBody)}`;
}

export interface VerifyInput {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: Buffer;
  nowSeconds: number;
  toleranceSeconds: number;
}

// The reason is for logs and tests only; the HTTP answer is the same generic 401 for every
// failure, so a caller cannot learn which part was wrong.
export function verifyWebhookSignature(input: VerifyInput): SignatureCheck {
  const { secret, timestamp, signature, rawBody, nowSeconds, toleranceSeconds } = input;
  if (!timestamp || !signature) {
    return 'missing';
  }
  const match = SIGNATURE_FORMAT.exec(signature);
  if (!TIMESTAMP_FORMAT.test(timestamp) || !match) {
    return 'malformed';
  }
  if (Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) {
    return 'expired';
  }

  const expected = Buffer.from(hmacHex(secret, timestamp, rawBody), 'hex');
  const received = Buffer.from(match[1]!, 'hex');
  // Constant-time comparison: a plain === returns at the first differing byte, which
  // leaks through timing how much of a forged signature was right. Both buffers are
  // 32 bytes here (the regex fixes the length), as timingSafeEqual requires.
  return timingSafeEqual(expected, received) ? 'ok' : 'mismatch';
}

function hmacHex(secret: string, timestamp: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}
