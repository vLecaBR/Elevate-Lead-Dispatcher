import type { FastifyInstance } from 'fastify';
import { signWebhook } from '../../src/modules/webhooks/signature.js';

// Dev secrets created by the demo seed (src/db/seed.ts).
export const devSecret = (slug: string) => `dev-webhook-secret-${slug}`;

export interface SendWebhookOptions {
  callCenter: string;
  body: object | string;
  secret?: string;
  timestamp?: number;
  headers?: Record<string, string>;
}

// Signs exactly the bytes it sends, like a real call center would.
export function sendWebhook(app: FastifyInstance, options: SendWebhookOptions) {
  const raw = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const secret = options.secret ?? devSecret(options.callCenter);
  return app.inject({
    method: 'POST',
    url: '/api/webhooks/callcenter',
    headers: {
      'content-type': 'application/json',
      'x-callcenter-id': options.callCenter,
      'x-elevate-timestamp': timestamp,
      'x-elevate-signature': signWebhook(secret, timestamp, Buffer.from(raw)),
      ...options.headers,
    },
    payload: raw,
  });
}
