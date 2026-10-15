import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/node_modules/', '**/dist/', '**/.next/', '**/next-env.d.ts', 'coverage/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        // `const { removed, ...rest } = obj` is the idiomatic way to omit keys.
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  // Formatting is Prettier's job; this turns off rules that would conflict with it.
  prettier,
);
