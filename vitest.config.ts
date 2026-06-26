import { defineConfig } from 'vitest/config';

// Single test runner for both the NestJS server and the Vite frontend. Vitest
// runs TypeScript natively (no ts-jest/babel config needed) and is already
// aligned with the project's Vite toolchain.
export default defineConfig({
  test: {
    include: ['server/**/*.spec.ts', 'web/src/**/*.spec.ts'],
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['server/**/*.ts', 'web/src/**/*.ts'],
      exclude: ['**/*.spec.ts', 'server/main.ts', 'server/serverless.ts'],
    },
  },
});
