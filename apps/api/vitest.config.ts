import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: [
        'src/auth/**/*.ts',
        'src/crypto/**/*.ts',
        '../../packages/shared/src/crypto.ts',
      ],
      allowExternal: true,
      exclude: ['src/**/*.test.ts'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
