import { runMigrations } from '../../src/db/migrate.js';
import { requireTestDatabaseUrl } from '../helpers/db.js';

// Runs once before all test files: the test database always has the current schema.
export default async function globalSetup(): Promise<void> {
  await runMigrations(requireTestDatabaseUrl());
}
