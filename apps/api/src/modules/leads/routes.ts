import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { currentUser } from '../../plugins/auth.js';
import { AppError } from '../../shared/errors.js';
import { LEAD_STATUSES } from '../status/state-machine.js';
import { changeStatusManually, getLeadDetail } from './detail-service.js';
import { listQuerySchema } from './list-query.js';
import { listLeadsPage } from './list-service.js';
import { buildLeadInputSchema, toValidationDetails } from './schema.js';
import { scopeFor } from './scope.js';
import { createLead } from './service.js';

const MAX_BODY_BYTES = 16 * 1024;

const idempotencyKeySchema = z.string().trim().min(1).max(255).optional();

export function registerLeadRoutes(app: FastifyInstance, { db, env }: { db: Db; env: Env }) {
  const leadInputSchema = buildLeadInputSchema(env.DEFAULT_PHONE_REGION);

  // Public endpoint for landing pages (no session).
  app.post(
    '/api/leads',
    {
      bodyLimit: MAX_BODY_BYTES,
      config: { public: true, rateLimit: { max: env.RATE_LIMIT_LEADS_PER_MIN } },
    },
    async (request, reply) => {
      const header = idempotencyKeySchema.safeParse(request.headers['idempotency-key']);
      if (!header.success) {
        throw new AppError(422, 'validation_error', 'Invalid Idempotency-Key header', [
          { field: 'header.idempotency-key', issue: header.error.issues[0]!.code },
        ]);
      }

      const body = leadInputSchema.safeParse(request.body);
      if (!body.success) {
        throw new AppError(
          422,
          'validation_error',
          'Invalid lead',
          toValidationDetails(body.error),
        );
      }

      const result = await createLead(db, body.data, header.data, {
        lockTimeoutMs: env.DISPATCH_LOCK_TIMEOUT_MS,
      });
      // Explicit response shape: never the database row.
      return reply.code(result.duplicate ? 200 : 201).send({
        success: true,
        lead_id: result.leadId,
        duplicate: result.duplicate,
      });
    },
  );

  // Session required (default-deny); the scope comes from the session, never the request.
  app.get('/api/leads', async (request) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw new AppError(
        422,
        'validation_error',
        'Invalid filters',
        toValidationDetails(query.error),
      );
    }
    const page = await listLeadsPage(
      db,
      scopeFor(currentUser(request)),
      query.data,
      env.APP_TIMEZONE,
    );
    return {
      success: true,
      data: page.leads.map(toListItemResponse),
      next_cursor: page.nextCursor,
    };
  });

  app.get<{ Params: { id: string } }>('/api/leads/:id', async (request) => {
    const scope = scopeFor(currentUser(request));
    const { lead, history, allowedNext } = await getLeadDetail(
      db,
      scope,
      parseLeadId(request.params.id),
    );
    return {
      success: true,
      lead: toLeadResponse(lead),
      history: history.map(toEventResponse),
      allowed_next: allowedNext,
    };
  });

  app.post<{ Params: { id: string } }>('/api/leads/:id/status', async (request) => {
    const user = currentUser(request);
    const body = statusChangeSchema.safeParse(request.body);
    if (!body.success) {
      throw new AppError(
        422,
        'validation_error',
        'Invalid status change',
        toValidationDetails(body.error),
      );
    }
    const result = await changeStatusManually(
      db,
      scopeFor(user),
      user,
      parseLeadId(request.params.id),
      body.data,
    );
    return { success: true, status: result.status };
  });
}

const statusChangeSchema = z.strictObject({
  status: z.enum(LEAD_STATUSES),
  note: z.string().trim().max(500).optional(),
});

// A malformed id cannot match any lead: same 404 as a missing or out-of-scope one.
function parseLeadId(id: string): string {
  if (!z.uuid().safeParse(id).success) {
    throw new AppError(404, 'lead_not_found', 'Lead not found');
  }
  return id;
}

// Explicit response shapes: never the database row.
function toListItemResponse(lead: Awaited<ReturnType<typeof listLeadsPage>>['leads'][number]) {
  return {
    id: lead.id,
    name: lead.name,
    email: lead.email,
    phone: lead.phoneE164,
    status: lead.status,
    source: lead.source,
    product: lead.productSlug,
    funnel: lead.funnelSlug,
    call_center:
      lead.callCenterSlug === null
        ? null
        : { slug: lead.callCenterSlug, name: lead.callCenterName },
    created_at: lead.createdAt,
    status_updated_at: lead.statusUpdatedAt,
  };
}

function toLeadResponse(lead: Awaited<ReturnType<typeof getLeadDetail>>['lead']) {
  return {
    id: lead.id,
    name: lead.name,
    email: lead.email,
    phone: lead.phoneE164,
    status: lead.status,
    status_updated_at: lead.statusUpdatedAt,
    created_at: lead.createdAt,
    source: lead.source,
    campaign: lead.campaign,
    utm: {
      source: lead.utmSource,
      medium: lead.utmMedium,
      campaign: lead.utmCampaign,
      content: lead.utmContent,
      term: lead.utmTerm,
    },
    product: { slug: lead.productSlug, name: lead.productName },
    funnel: { slug: lead.funnelSlug, name: lead.funnelName },
    affiliate_code: lead.affiliateCode,
    call_center:
      lead.callCenterId === null
        ? null
        : { id: lead.callCenterId, slug: lead.callCenterSlug, name: lead.callCenterName },
    distributed_at: lead.distributedAt,
    external_id: lead.externalId,
  };
}

function toEventResponse(event: Awaited<ReturnType<typeof getLeadDetail>>['history'][number]) {
  return {
    status: event.status,
    event_ts: event.eventTs,
    received_at: event.receivedAt,
    source: event.source,
    note: event.note,
  };
}
