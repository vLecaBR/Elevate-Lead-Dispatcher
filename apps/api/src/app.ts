import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Env } from './config/env.js';
import { createDb } from './db/client.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerCatalogRoutes } from './modules/catalog/routes.js';
import { registerDashboardRoutes } from './modules/dashboard/routes.js';
import { registerDispatcherRoutes } from './modules/dispatcher/routes.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { registerLeadRoutes } from './modules/leads/routes.js';
import { webhookRoutes } from './modules/webhooks/routes.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { AppError } from './shared/errors.js';

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
  // Security headers. A JSON API serves no HTML, so helmet's defaults are enough.
  void app.register(helmet);
  // Per-IP limits, in memory (one API instance; with several, the same plugin takes a
  // Redis store). Routes override `max` through config.rateLimit. Registered before the
  // routes: Fastify applies plugins and routes in registration order.
  void app.register(rateLimit, {
    max: env.RATE_LIMIT_GLOBAL_PER_MIN,
    timeWindow: '1 minute',
    errorResponseBuilder: () => new AppError(429, 'rate_limited', 'Too many requests, retry later'),
  });
  registerAuth(app, { db, allowedOrigins: env.ALLOWED_ORIGINS });

  // Routes go in a plugin queued after the plugins above. The rate limiter attaches to
  // routes through an onRoute hook, which only sees routes registered after it loaded;
  // routes declared directly on the root here would silently get no limit (a test covers
  // it). Root hooks (auth, error handler) still apply inside.
  void app.register(async (api) => {
    registerHealthRoutes(api, pool);
    registerAuthRoutes(api, { db, env });
    registerDispatcherRoutes(api, { db, env });
    registerLeadRoutes(api, { db, env });
    registerCatalogRoutes(api, { db });
    registerDashboardRoutes(api, { db, env });
    await api.register(webhookRoutes, { db, env });
  });

  return app;
}
