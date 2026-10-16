import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { findSessionUser } from '../modules/auth/repository.js';
import { hashSessionToken, SESSION_COOKIE, type SessionUser } from '../modules/auth/session.js';

declare module 'fastify' {
  interface FastifyRequest {
    // Set from the session cookie on every request; null when anonymous.
    user: SessionUser | null;
  }
}

// Registered on the root instance, so the hook runs for every route.
// Resolves the session cookie into request.user ("who is calling").
export function registerAuth(app: FastifyInstance, { db }: { db: Db }): void {
  void app.register(fastifyCookie);
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.user = token ? ((await findSessionUser(db, hashSessionToken(token))) ?? null) : null;
  });
}
