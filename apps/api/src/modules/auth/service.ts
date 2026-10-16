import type { Db } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import { hashPassword, verifyPassword } from '../../shared/password.js';
import {
  clearFailedLogins,
  deleteSession,
  findUserByEmail,
  insertSession,
  registerFailedLogin,
} from './repository.js';
import { hashSessionToken, newSessionToken, type SessionUser } from './session.js';

// Per account, complementing the per-IP rate limit on the login route: guessing one
// user's password from many IPs still stops after 5 tries (PLAN.md §10).
const LOCKOUT = { maxFailures: 5, lockMinutes: 15 };

// One answer for every failed login (unknown e-mail, wrong password, inactive user): the
// response does not reveal which e-mails exist.
const invalidCredentials = () =>
  new AppError(401, 'invalid_credentials', 'Invalid e-mail or password');

// Argon2 takes tens of milliseconds by design. If an unknown e-mail returned without
// hashing, the response time alone would reveal which e-mails exist, so we verify against
// a throwaway hash instead. Created once, on first use.
let phantomHash: Promise<string> | undefined;
const getPhantomHash = () => (phantomHash ??= hashPassword('phantom-password-never-matches'));

export async function login(
  db: Db,
  credentials: { email: string; password: string },
  ttlHours: number,
): Promise<{ token: string; user: SessionUser }> {
  const user = await findUserByEmail(db, credentials.email.trim().toLowerCase());
  if (!user) {
    await verifyPassword(await getPhantomHash(), credentials.password);
    throw invalidCredentials();
  }

  // The hash is always verified (same cost on every path), and a locked account answers
  // exactly like a wrong password: an attacker cannot tell the lock is on.
  const passwordOk = await verifyPassword(user.passwordHash, credentials.password);
  if (user.isLocked || !user.isActive) {
    throw invalidCredentials();
  }
  if (!passwordOk) {
    await registerFailedLogin(db, user.id, LOCKOUT);
    throw invalidCredentials();
  }
  await clearFailedLogins(db, user.id);

  const { token, tokenHash } = newSessionToken();
  await insertSession(db, { tokenHash, userId: user.id, ttlHours });
  return {
    token,
    user: { id: user.id, email: user.email, role: user.role, callCenterId: user.callCenterId },
  };
}

export async function logout(db: Db, token: string): Promise<void> {
  await deleteSession(db, hashSessionToken(token));
}
