import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Tests read the same root .env as `npm run dev:api`. It is optional so CI can pass
// variables directly; values already set in the shell win over the file.
const rootEnvFile = path.resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
