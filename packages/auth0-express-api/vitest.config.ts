import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        '**/test-utils/**',
        '**/types/*.ts',
        '**/types.ts',
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/node_modules/**',
        '**/dist/**',
      ],
    },
  },
});
