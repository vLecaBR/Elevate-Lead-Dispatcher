import type { FastifyInstance } from 'fastify';
import type { Env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { requireRole } from '../../plugins/auth.js';
import { redispatchPending } from './service.js';

export function registerDispatcherRoutes(app: FastifyInstance, { db, env }: { db: Db; env: Env }) {
  // Distributes leads that were created while no call center was eligible.
  app.post(
    '/api/admin/dispatcher/redispatch-pending',
    { preHandler: requireRole('ADMIN') },
    async () => {
      const result = await redispatchPending(db, { lockTimeoutMs: env.DISPATCH_LOCK_TIMEOUT_MS });
      return { success: true, distributed: result.distributed, remaining: result.remaining };
    },
  );
}
