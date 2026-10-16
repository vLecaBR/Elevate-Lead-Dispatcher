import type { Db } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import { hashPassword, verifyPassword } from '../../shared/password.js';
import { deleteSession, findUserByEmail, insertSession } from './repository.js';
import { hashSessionToken, newSessionToken, type SessionUser } from './session.js';

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

  const passwordOk = await verifyPassword(user.passwordHash, credentials.password);
  if (!passwordOk || !user.isActive) {
    throw invalidCredentials();
  }

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
