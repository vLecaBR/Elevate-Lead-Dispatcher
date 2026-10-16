import type { FastifyInstance } from 'fastify';
import type { Env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import { toValidationDetails } from '../leads/schema.js';
import { findCallCenterBySlug } from './repository.js';
import { webhookPayloadSchema } from './schema.js';
import { handleStatusWebhook } from './service.js';
import { verifyWebhookSignature } from './signature.js';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
// Used when the call center slug is unknown, so that case still computes an HMAC and
// takes about as long as a wrong signature (no timing hint about which slugs exist).
const UNKNOWN_CALL_CENTER_SECRET = 'unknown-call-center';

function header(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// Encapsulated plugin: only inside it, application/json is kept as the raw Buffer, because
// the HMAC must be computed over the exact bytes received. The rest of the API keeps the
// normal JSON parser.
export async function webhookRoutes(app: FastifyInstance, { db, env }: { db: Db; env: Env }) {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: MAX_BODY_BYTES },
    (_request, body, done) => done(null, body),
  );

  // Public route authenticated by HMAC (no session).
  app.post<{ Body: Buffer }>('/api/webhooks/callcenter', async (request, reply) => {
    const rawBody = request.body ?? Buffer.alloc(0);
    const slug = header(request.headers['x-callcenter-id']);
    const callCenter = slug ? await findCallCenterBySlug(db, slug) : undefined;
    const check = verifyWebhookSignature({
      secret: callCenter?.webhookSecret ?? UNKNOWN_CALL_CENTER_SECRET,
      timestamp: header(request.headers['x-elevate-timestamp']),
      signature: header(request.headers['x-elevate-signature']),
      rawBody,
      nowSeconds: Math.floor(Date.now() / 1000),
      toleranceSeconds: env.WEBHOOK_TOLERANCE_SECONDS,
    });
    if (!callCenter || check !== 'ok') {
      // Detailed reason in the log, one generic answer to the caller.
      request.log.warn(
        { callCenter: slug, reason: callCenter ? check : 'unknown_call_center' },
        'webhook rejected',
      );
      throw new AppError(401, 'invalid_signature', 'Invalid webhook signature');
    }

    // Parse only after the signature proved who sent these bytes.
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new AppError(400, 'invalid_json', 'Body is not valid JSON');
    }
    const parsed = webhookPayloadSchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError(
        422,
        'validation_error',
        'Invalid webhook payload',
        toValidationDetails(parsed.error),
      );
    }
    if (Date.parse(parsed.data.event_ts) > Date.now() + MAX_FUTURE_SKEW_MS) {
      throw new AppError(422, 'validation_error', 'event_ts is in the future', [
        { field: 'event_ts', issue: 'in_future' },
      ]);
    }

    const outcome = await handleStatusWebhook(db, callCenter.id, parsed.data);
    if (outcome.externalIdConflict) {
      request.log.warn(
        { callCenterId: callCenter.id, leadId: parsed.data.lead_id },
        'webhook external_id differs from the one on the distribution; kept on the event only',
      );
    }
    return reply.code(200).send({ success: true, result: outcome.result });
  });
}
