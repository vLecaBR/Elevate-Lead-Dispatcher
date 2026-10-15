import { defineConfig } from 'drizzle-kit';

// Only `drizzle-kit generate` uses this file; it diffs the schema against the snapshots in
// src/db/migrations/meta and does not need a database connection.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
});
