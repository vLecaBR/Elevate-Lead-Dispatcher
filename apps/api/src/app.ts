import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Env } from './config/env.js';
import { createDb } from './db/client.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { registerLeadRoutes } from './modules/leads/routes.js';
import { webhookRoutes } from './modules/webhooks/routes.js';
import { registerErrorHandler } from './plugins/error-handler.js';

export interface AppDeps {
  env: Env;
  pool: pg.Pool;
}

// Factory with no side effects (no listen, no connections opened): tests build the app
// with their own pool and call it through inject().
export function buildApp({ env, pool }: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Credentials, signatures and personal data must never reach the logs.
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'req.headers["x-elevate-signature"]',
          'res.headers["set-cookie"]',
          '*.email',
          '*.phone',
        ],
        censor: '[redacted]',
      },
    },
  });

  // JSON-only API: without the default text/plain parser, any other content type gets 415
  // instead of reaching the handlers as a raw string.
  app.removeContentTypeParser('text/plain');

  const db = createDb(pool);
  registerErrorHandler(app);
  registerHealthRoutes(app, pool);
  registerLeadRoutes(app, { db, env });
  void app.register(webhookRoutes, { db, env });

  return app;
}
