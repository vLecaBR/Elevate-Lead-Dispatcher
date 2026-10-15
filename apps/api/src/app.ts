import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Env } from './config/env.js';
import { registerHealthRoutes } from './modules/health/routes.js';
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
          'req.headers["x-signature"]',
          'res.headers["set-cookie"]',
          '*.email',
          '*.phone',
        ],
        censor: '[redacted]',
      },
    },
  });

  registerErrorHandler(app);
  registerHealthRoutes(app, pool);

  return app;
}
