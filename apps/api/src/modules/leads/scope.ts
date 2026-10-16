import type { SessionUser } from '../auth/session.js';

// Which leads a user may see or change. It is derived ONLY from the session, never from a
// request parameter, and every user-facing lead query in the repository takes it as a
// required argument: forgetting it does not compile.
export type LeadScope = { kind: 'all' } | { kind: 'callCenter'; callCenterId: number };

export function scopeFor(user: SessionUser): LeadScope {
  if (user.role === 'ADMIN') {
    return { kind: 'all' };
  }
  // The users CHECK constraint guarantees an OPERATOR has a call center; fail closed anyway.
  if (user.callCenterId === null) {
    throw new Error(`operator ${user.id} has no call center`);
  }
  return { kind: 'callCenter', callCenterId: user.callCenterId };
}
