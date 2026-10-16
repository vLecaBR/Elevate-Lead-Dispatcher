import { defineConfig } from 'vitest/config';

// Pure functions only (no DOM): the UI itself is checked by hand in the browser.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
