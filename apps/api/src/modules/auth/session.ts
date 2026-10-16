import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'sid';

export type UserRole = 'ADMIN' | 'OPERATOR';

// What the rest of the API knows about the logged-in user (never the row itself).
export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  callCenterId: number | null;
}

// 256 random bits: unguessable. The cookie carries the token; the database only stores its
// sha256, so a leaked sessions table cannot be replayed as cookies.
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionCookieOptions(secure: boolean, ttlHours: number) {
  return {
    path: '/',
    // Not readable from JavaScript (XSS cannot steal it).
    httpOnly: true,
    // Never sent on cross-site requests: the main CSRF barrier.
    sameSite: 'strict' as const,
    secure,
    maxAge: ttlHours * 3600,
  };
}
