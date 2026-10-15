import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { pingDatabase } from '../../db/client.js';

export function registerHealthRoutes(app: FastifyInstance, pool: pg.Pool): void {
  // Liveness: the process is up. Never touches the database, so a slow DB does not
  // get a healthy container restarted.
  app.get('/health', async () => ({ status: 'ok' }));

  // Readiness: the API can serve traffic, which requires the database.
  app.get('/ready', async (_request, reply) => {
    if (await pingDatabase(pool)) {
      return { status: 'ok' };
    }
    return reply.code(503).send({ status: 'unavailable' });
  });
}
