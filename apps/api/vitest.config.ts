import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: [
        'src/auth/**/*.ts',
        '../../packages/llm/src/integrity.ts',
        'src/crypto/**/*.ts',
        '../../packages/shared/src/crypto.ts',
        '../../packages/shared/src/matching.ts',
        '../../packages/db/src/matching-repository.ts',
        '../worker/src/matching/scoring.ts',
        '../worker/src/email/email-alerts.ts',
        '../../packages/db/src/email-repository.ts',
      ],
      allowExternal: true,
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        '../../packages/llm/src/integrity.ts': {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 80,
        },
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
        '../worker/src/email/email-alerts.ts': {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 80,
        },
        '../../packages/db/src/email-repository.ts': {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 80,
        },
        '../worker/src/matching/scoring.ts': {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 80,
        },
        '../../packages/db/src/matching-repository.ts': {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 80,
        },
        '../../packages/shared/src/matching.ts': {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 80,
        },
      },
    },
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
