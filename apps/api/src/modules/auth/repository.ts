import { and, eq, gt, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { sessions, users } from '../../db/schema.js';
import type { SessionUser } from './session.js';

export interface LoginCandidate extends SessionUser {
  passwordHash: string;
  isActive: boolean;
}

// Internal only: password_hash is used to verify and never leaves the service.
export async function findUserByEmail(db: Db, email: string): Promise<LoginCandidate | undefined> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      callCenterId: users.callCenterId,
      passwordHash: users.passwordHash,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.email, email));
  return row;
}

export async function insertSession(
  db: Db,
  session: { tokenHash: string; userId: string; ttlHours: number },
): Promise<void> {
  await db.insert(sessions).values({
    tokenHash: session.tokenHash,
    userId: session.userId,
    expiresAt: sql`now() + make_interval(hours => ${session.ttlHours})`,
  });
}

// Runs on every authenticated request (primary key lookup). An expired session or a
// deactivated user simply finds nothing: access is revoked at once, without waiting for
// the cookie to expire.
export async function findSessionUser(db: Db, tokenHash: string): Promise<SessionUser | undefined> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      callCenterId: users.callCenterId,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, sql`now()`),
        eq(users.isActive, true),
      ),
    );
  return row;
}

export async function deleteSession(db: Db, tokenHash: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}
