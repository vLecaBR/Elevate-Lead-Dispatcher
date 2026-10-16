import type { FastifyInstance } from 'fastify';
import { DEMO_PASSWORD } from '../../src/db/seed.js';

// Logs in as a demo seed user and returns the Cookie header value for later requests.
export async function loginAs(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: DEMO_PASSWORD },
  });
  if (response.statusCode !== 200) {
    throw new Error(`login as ${email} failed: ${response.statusCode} ${response.body}`);
  }
  const sid = response.cookies.find((c) => c.name === 'sid');
  return `sid=${sid!.value}`;
}

export const ADMIN = 'admin@elevate.local';
export const OPERATOR_A = 'operator.a@elevate.local';
export const OPERATOR_B = 'operator.b@elevate.local';
