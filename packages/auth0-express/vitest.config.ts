import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        '**/test-utils/**',
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/node_modules/**',
        '**/dist/**',
      ],
    },
  },
});
