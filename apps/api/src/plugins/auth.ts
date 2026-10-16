import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { findSessionUser } from '../modules/auth/repository.js';
import {
  hashSessionToken,
  SESSION_COOKIE,
  type SessionUser,
  type UserRole,
} from '../modules/auth/session.js';
import { AppError } from '../shared/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    // Set from the session cookie on every request; null when anonymous.
    user: SessionUser | null;
  }
  interface FastifyContextConfig {
    // Opt-out of authentication. Only the allowlist of PLAN.md §10 sets it; a route that
    // does not say anything is protected.
    public?: boolean;
    // The route creates a session (login): Origin is checked even without a cookie.
    setsSession?: boolean;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Registered on the root instance, so the hooks run for every route.
export function registerAuth(
  app: FastifyInstance,
  { db, allowedOrigins }: { db: Db; allowedOrigins: readonly string[] },
): void {
  void app.register(fastifyCookie);
  app.decorateRequest('user', null);

  // preParsing: after every onRequest hook (so the rate limiter rejects floods before we
  // touch the database) and before the body is parsed (anonymous calls to protected routes
  // are refused without parsing their payload).
  app.addHook('preParsing', async (request, _reply, payload) => {
    const config = request.routeOptions.config;
    const token = request.cookies[SESSION_COOKIE];

    // CSRF defense in depth (SameSite=Strict is the main barrier): a state-changing
    // request that rides on our cookie, or that logs in, must come from our own front end
    // when the browser says where it comes from. Public machine endpoints (intake from
    // landing pages on other domains, webhooks) use no cookie and are not affected.
    const origin = request.headers.origin;
    if (
      !SAFE_METHODS.has(request.method) &&
      (token !== undefined || config.setsSession) &&
      origin !== undefined &&
      !allowedOrigins.includes(origin)
    ) {
      throw new AppError(403, 'forbidden_origin', 'Origin not allowed');
    }

    request.user = token ? ((await findSessionUser(db, hashSessionToken(token))) ?? null) : null;

    // Default-deny: every route requires a session unless it is explicitly public.
    // Unknown URLs fall through to the normal 404.
    if (!config.public && !request.is404 && !request.user) {
      throw new AppError(401, 'unauthenticated', 'Authentication required');
    }
    return payload;
  });
}

// For handlers of protected routes: the hook above guarantees the user is there.
export function currentUser(request: FastifyRequest): SessionUser {
  if (!request.user) {
    throw new AppError(401, 'unauthenticated', 'Authentication required');
  }
  return request.user;
}

// preHandler guard for role-restricted routes: authenticated but not allowed -> 403.
export function requireRole(role: UserRole) {
  return async (request: FastifyRequest) => {
    if (currentUser(request).role !== role) {
      throw new AppError(403, 'forbidden', 'Not allowed for this role');
    }
  };
}
