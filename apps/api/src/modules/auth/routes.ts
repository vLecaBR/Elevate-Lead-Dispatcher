import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { currentUser } from '../../plugins/auth.js';
import { AppError } from '../../shared/errors.js';
import { toValidationDetails } from '../leads/schema.js';
import { login, logout } from './service.js';
import { SESSION_COOKIE, type SessionUser, sessionCookieOptions } from './session.js';

const loginSchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(256),
});

// Explicit output shape: never the users row (no password_hash, no lockout fields).
function toUserResponse(user: SessionUser) {
  return { id: user.id, email: user.email, role: user.role, call_center_id: user.callCenterId };
}

export function registerAuthRoutes(app: FastifyInstance, { db, env }: { db: Db; env: Env }) {
  app.post(
    '/api/auth/login',
    {
      config: {
        public: true,
        setsSession: true,
        // Per IP; the per-account lockout lives in the service.
        rateLimit: { max: env.RATE_LIMIT_LOGIN_PER_MIN },
      },
    },
    async (request, reply) => {
      const body = loginSchema.safeParse(request.body);
      if (!body.success) {
        throw new AppError(
          422,
          'validation_error',
          'Invalid login',
          toValidationDetails(body.error),
        );
      }

      const { token, user } = await login(db, body.data, env.SESSION_TTL_HOURS);
      reply.setCookie(
        SESSION_COOKIE,
        token,
        sessionCookieOptions(env.COOKIE_SECURE, env.SESSION_TTL_HOURS),
      );
      return { success: true, user: toUserResponse(user) };
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      await logout(db, token);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { success: true };
  });

  app.get('/api/auth/me', async (request) => ({
    success: true,
    user: toUserResponse(currentUser(request)),
  }));
}
