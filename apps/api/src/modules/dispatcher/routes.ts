import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { requireRole } from '../../plugins/auth.js';
import { AppError } from '../../shared/errors.js';
import { toValidationDetails } from '../leads/schema.js';
import { changeCallCenterConfig, getDispatcherSummary } from './admin-service.js';
import { redispatchPending } from './service.js';

const configChangeSchema = z
  .strictObject({
    weight: z.number().int().min(0).max(1000).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((body) => body.weight !== undefined || body.is_active !== undefined, {
    message: 'nothing_to_change',
  });

const adminOnly = { preHandler: requireRole('ADMIN') };

export function registerDispatcherRoutes(app: FastifyInstance, { db, env }: { db: Db; env: Env }) {
  app.get('/api/admin/dispatcher', adminOnly, async () => {
    const summary = await getDispatcherSummary(db);
    return {
      success: true,
      pending: summary.pending,
      call_centers: summary.callCenters.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        weight: c.weight,
        is_active: c.isActive,
        target_pct: c.targetPct,
        distributed: c.distributed,
        actual_pct: c.actualPct,
      })),
    };
  });

  app.patch<{ Params: { id: string } }>(
    '/api/admin/call-centers/:id',
    adminOnly,
    async (request) => {
      const id = z.coerce.number().int().positive().safeParse(request.params.id);
      if (!id.success) {
        throw new AppError(404, 'call_center_not_found', 'Call center not found');
      }
      const body = configChangeSchema.safeParse(request.body);
      if (!body.success) {
        throw new AppError(
          422,
          'validation_error',
          'Invalid call center change',
          toValidationDetails(body.error),
        );
      }

      const updated = await changeCallCenterConfig(db, id.data, {
        weight: body.data.weight,
        isActive: body.data.is_active,
      });
      // Explicit shape: never the webhook secret.
      return {
        success: true,
        call_center: {
          id: updated.id,
          slug: updated.slug,
          name: updated.name,
          weight: updated.weight,
          is_active: updated.isActive,
        },
      };
    },
  );

  // Distributes leads that were created while no call center was eligible.
  app.post('/api/admin/dispatcher/redispatch-pending', adminOnly, async () => {
    const result = await redispatchPending(db, { lockTimeoutMs: env.DISPATCH_LOCK_TIMEOUT_MS });
    return { success: true, distributed: result.distributed, remaining: result.remaining };
  });
}
