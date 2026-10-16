import type { FastifyInstance } from 'fastify';
import type { Env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { requireRole } from '../../plugins/auth.js';
import { LEAD_STATUSES } from '../status/state-machine.js';
import { countLeads, countLeadsByStatus } from './repository.js';

export function registerDashboardRoutes(app: FastifyInstance, { db, env }: { db: Db; env: Env }) {
  app.get('/api/dashboard/metrics', { preHandler: requireRole('ADMIN') }, async () => {
    const [counts, byStatus] = await Promise.all([
      countLeads(db, env.APP_TIMEZONE),
      countLeadsByStatus(db),
    ]);

    // Every status present, zero included, so the front end does not guess.
    const statusCounts = Object.fromEntries(LEAD_STATUSES.map((status) => [status, 0]));
    for (const row of byStatus) {
      statusCounts[row.status] = row.count;
    }

    return {
      success: true,
      total: counts.total,
      today: counts.today,
      distributed: counts.distributed,
      pending: counts.pending,
      sales: counts.sales,
      // Sales over all received leads (not over distributed ones), 4 decimal places.
      conversion_rate: counts.total === 0 ? 0 : Number((counts.sales / counts.total).toFixed(4)),
      by_status: statusCounts,
    };
  });
}
