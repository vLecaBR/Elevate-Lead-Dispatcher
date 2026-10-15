import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import { buildLeadInputSchema, toValidationDetails } from './schema.js';
import { createLead } from './service.js';

const MAX_BODY_BYTES = 16 * 1024;

const idempotencyKeySchema = z.string().trim().min(1).max(255).optional();

export function registerLeadRoutes(app: FastifyInstance, { db, env }: { db: Db; env: Env }) {
  const leadInputSchema = buildLeadInputSchema(env.DEFAULT_PHONE_REGION);

  // Public endpoint for landing pages (no session).
  app.post('/api/leads', { bodyLimit: MAX_BODY_BYTES }, async (request, reply) => {
    const header = idempotencyKeySchema.safeParse(request.headers['idempotency-key']);
    if (!header.success) {
      throw new AppError(422, 'validation_error', 'Invalid Idempotency-Key header', [
        { field: 'header.idempotency-key', issue: header.error.issues[0]!.code },
      ]);
    }

    const body = leadInputSchema.safeParse(request.body);
    if (!body.success) {
      throw new AppError(422, 'validation_error', 'Invalid lead', toValidationDetails(body.error));
    }

    const result = await createLead(db, body.data, header.data);
    // Explicit response shape: never the database row.
    return reply.code(result.duplicate ? 200 : 201).send({
      success: true,
      lead_id: result.leadId,
      duplicate: result.duplicate,
    });
  });
}
