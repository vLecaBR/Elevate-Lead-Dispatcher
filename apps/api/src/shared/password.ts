import { hash } from '@node-rs/argon2';

// OWASP Password Storage Cheat Sheet, Argon2id minimum: 19 MiB memory, 2 iterations,
// parallelism 1. The library's default algorithm is Argon2id (its `Algorithm` is a const
// enum, which isolatedModules cannot import), and the PHC string records every parameter,
// so they can be raised later without breaking existing hashes.
const options = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, options);
}
